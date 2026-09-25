import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import initialSchema from "../migrations/0001_initial.sql?raw";
import {
  InvalidQueueConfigurationError,
  loadPublicQueueConfiguration,
  loadQueueConfigurationById,
} from "../src/queue-config.js";

const migration = {
  name: "0001_initial.sql",
  queries: initialSchema
    .split(";")
    .map((query) => query.trim())
    .filter((query) => query.length > 0),
};
const timestamp = "2026-09-25T13:40:00.000Z";

describe("D1 queue configuration", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, [migration]);
  });

  afterEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM ticket_history"),
      env.DB.prepare("DELETE FROM audit_history"),
      env.DB.prepare("DELETE FROM display_tokens"),
      env.DB.prepare("DELETE FROM shop_staff"),
      env.DB.prepare("DELETE FROM queue_definitions"),
      env.DB.prepare("DELETE FROM services"),
      env.DB.prepare("DELETE FROM projections_pending"),
      env.DB.prepare("DELETE FROM shops"),
      env.DB.prepare("DELETE FROM merchants"),
    ]);
  });

  it("applies the initial migration once and enforces uniqueness and foreign keys", async () => {
    await applyD1Migrations(env.DB, [migration]);
    await seedBaseQueue();

    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA'
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(new Set(tables.results.map((table) => table.name))).toEqual(
      new Set([
        "audit_history",
        "d1_migrations",
        "display_tokens",
        "merchants",
        "projections_pending",
        "queue_definitions",
        "services",
        "shop_staff",
        "shops",
        "ticket_history",
      ]),
    );

    await expect(
      env.DB.prepare(
        `INSERT INTO merchants (merchant_id, email_normalized, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
      )
        .bind("merchant_02", "owner@example.test", "test-only-hash", timestamp, timestamp)
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO queue_definitions (
           queue_id, shop_id, public_slug, name, prefix, start_sequence,
           grace_period_seconds, service_capacity, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
        .bind(
          "queue_invalid_shop",
          "shop_missing",
          "other-queue",
          "Other queue",
          "B",
          1,
          300,
          1,
          timestamp,
          timestamp,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO queue_definitions (
           queue_id, shop_id, public_slug, name, prefix, start_sequence,
           grace_period_seconds, service_capacity, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
        .bind(
          "queue_fractional_sequence",
          "shop_01",
          "fractional-queue",
          "Fractional queue",
          "C",
          25.5,
          300,
          1,
          timestamp,
          timestamp,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO services (
           service_id, shop_id, name, default_duration_seconds, active, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
      )
        .bind("service_fractional_duration", "shop_01", "Fractional", 30.5, timestamp, timestamp)
        .run(),
    ).rejects.toThrow();
  });

  it("loads an active config by slug or ID and snapshots ordered active services", async () => {
    await seedBaseQueue();
    await env.DB.prepare(
      `INSERT INTO services (
         service_id, shop_id, name, default_duration_seconds, active, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind("service_02", "shop_01", "Color", 3600, 20, timestamp, timestamp)
      .run();

    const bySlug = await loadPublicQueueConfiguration(env.DB, "northside-hair");
    expect(bySlug).toEqual({
      queueId: "queue_01",
      publicSlug: "northside-hair",
      shopName: "Northside Hair",
      configSnapshot: {
        prefix: "A",
        startSequence: 25,
        gracePeriodSeconds: 300,
        serviceCapacity: 2,
        returnWindowBufferSeconds: 300,
        services: [
          { serviceId: "service_01", name: "Haircut", defaultDurationSeconds: 1800 },
          { serviceId: "service_02", name: "Color", defaultDurationSeconds: 3600 },
        ],
      },
    });
    expect(await loadQueueConfigurationById(env.DB, "queue_01")).toEqual(bySlug);
    expect(bySlug).not.toHaveProperty("password_hash");
    expect(bySlug).not.toHaveProperty("owner_merchant_id");
  });

  it("hides inactive business records and rejects unusable service configuration", async () => {
    await seedBaseQueue();
    expect(await loadPublicQueueConfiguration(env.DB, "missing-queue")).toBeNull();

    await env.DB.prepare("UPDATE queue_definitions SET status = 'ARCHIVED' WHERE queue_id = ?")
      .bind("queue_01")
      .run();
    expect(await loadPublicQueueConfiguration(env.DB, "northside-hair")).toBeNull();

    await env.DB.prepare("UPDATE queue_definitions SET status = 'ACTIVE' WHERE queue_id = ?")
      .bind("queue_01")
      .run();
    await env.DB.prepare("UPDATE shops SET status = 'SUSPENDED' WHERE shop_id = ?")
      .bind("shop_01")
      .run();
    expect(await loadQueueConfigurationById(env.DB, "queue_01")).toBeNull();

    await env.DB.prepare("UPDATE shops SET status = 'ACTIVE' WHERE shop_id = ?")
      .bind("shop_01")
      .run();
    await env.DB.prepare("UPDATE merchants SET status = 'SUSPENDED' WHERE merchant_id = ?")
      .bind("merchant_01")
      .run();
    expect(await loadPublicQueueConfiguration(env.DB, "northside-hair")).toBeNull();

    await env.DB.prepare("UPDATE merchants SET status = 'ACTIVE' WHERE merchant_id = ?")
      .bind("merchant_01")
      .run();
    await env.DB.prepare("UPDATE services SET active = 0 WHERE shop_id = ?").bind("shop_01").run();
    await expect(loadPublicQueueConfiguration(env.DB, "northside-hair")).rejects.toBeInstanceOf(
      InvalidQueueConfigurationError,
    );
  });
});

async function seedBaseQueue(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO merchants (merchant_id, email_normalized, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
  )
    .bind("merchant_01", "owner@example.test", "test-only-hash", timestamp, timestamp)
    .run();
  await env.DB.prepare(
    `INSERT INTO shops (
       shop_id, owner_merchant_id, name, timezone, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  )
    .bind("shop_01", "merchant_01", "Northside Hair", "Asia/Singapore", timestamp, timestamp)
    .run();
  await env.DB.prepare(
    `INSERT INTO shop_staff (shop_id, merchant_id, role, status, created_at)
     VALUES (?, ?, 'OWNER', 'ACTIVE', ?)`,
  )
    .bind("shop_01", "merchant_01", timestamp)
    .run();
  await env.DB.prepare(
    `INSERT INTO queue_definitions (
       queue_id, shop_id, public_slug, name, prefix, start_sequence,
       grace_period_seconds, service_capacity, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  )
    .bind(
      "queue_01",
      "shop_01",
      "northside-hair",
      "Walk-ins",
      "A",
      25,
      300,
      2,
      timestamp,
      timestamp,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO services (
       service_id, shop_id, name, default_duration_seconds, active, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("service_01", "shop_01", "Haircut", 1800, 1, 10, timestamp, timestamp)
    .run();
  await env.DB.prepare(
    `INSERT INTO services (
       service_id, shop_id, name, default_duration_seconds, active, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("service_inactive", "shop_01", "Inactive", 2400, 0, 5, timestamp, timestamp)
    .run();
}
