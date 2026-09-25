import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const sessionConfig = {
  prefix: "A",
  startSequence: 25,
  gracePeriodSeconds: 300,
  serviceCapacity: 2,
  returnWindowBufferSeconds: 300,
  services: [
    {
      serviceId: "service_01",
      name: "Haircut",
      defaultDurationSeconds: 1800,
    },
  ],
};

describe("Queue API Worker runtime", () => {
  it("serves only the public health route", async () => {
    const context = createExecutionContext();
    const healthResponse = await exports.default.fetch(
      new Request("https://queuenow.test/health"),
      env,
      context,
    );
    await waitOnExecutionContext(context);

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: "ok" });

    const internalResponse = await exports.default.fetch(
      new Request("https://queuenow.test/_internal/sessions/open", {
        method: "POST",
        body: "{}",
      }),
      env,
      createExecutionContext(),
    );
    expect(internalResponse.status).toBe(404);
    const internalJoinResponse = await exports.default.fetch(
      new Request("https://queuenow.test/_internal/tickets/join", {
        method: "POST",
        body: "{}",
      }),
      env,
      createExecutionContext(),
    );
    expect(internalJoinResponse.status).toBe(404);
    const internalCallNextResponse = await exports.default.fetch(
      new Request("https://queuenow.test/_internal/queue/call-next", {
        method: "POST",
        body: "{}",
      }),
      env,
      createExecutionContext(),
    );
    expect(internalCallNextResponse.status).toBe(404);
  });

  it("runs schema migrations once through the Durable Object binding", async () => {
    const id = env.QUEUES.idFromName("queue-schema-test");
    const stub = env.QUEUES.get(id);
    const url = "https://queue-do.test/_internal/health";

    const firstResponse = await stub.fetch(url);
    const secondResponse = await stub.fetch(url);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({
      status: "ok",
      schemaVersion: 3,
      sessionCount: 0,
    });
  });

  it("atomically persists queue configuration and replays exact open commands", async () => {
    const queueId = "queue-session-test";
    const id = env.QUEUES.idFromName(queueId);
    const stub = env.QUEUES.get(id);
    const url = "https://queue-do.test/_internal/sessions/open";
    const command = {
      commandId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
      actorScope: "merchant-account-01",
      queueId,
      configSnapshot: sessionConfig,
    };
    const sendOpen = (body: unknown) =>
      stub.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const configRequiredResponse = await sendOpen({
      commandId: "69ea98d3-9a5b-47ec-9eb2-268496aef87f",
      actorScope: command.actorScope,
      queueId,
    });
    expect(configRequiredResponse.status).toBe(400);
    expect(await configRequiredResponse.json()).toMatchObject({
      error: { code: "QUEUE_CONFIG_REQUIRED" },
    });

    const invalidResponse = await sendOpen({
      ...command,
      configSnapshot: { ...sessionConfig, startSequence: Number.MAX_SAFE_INTEGER },
    });
    expect(invalidResponse.status).toBe(400);

    const [firstResponse, retryResponse] = await Promise.all([
      sendOpen(command),
      sendOpen(command),
    ]);
    expect(firstResponse.status).toBe(201);
    expect(retryResponse.status).toBe(201);
    const opened = await firstResponse.json();
    expect(await retryResponse.json()).toEqual(opened);
    expect(opened).toMatchObject({
      queueId,
      status: "OPEN",
      queueRevision: 0,
    });

    const persisted = await runInDurableObject(stub, (_instance, state) => {
      const session = state.storage.sql
        .exec<{
          session_id: string;
          queue_id: string;
          status: string;
          next_sequence: number;
          config_snapshot_json: string;
          is_current: number;
        }>(
          `SELECT session_id, queue_id, status, next_sequence, config_snapshot_json, is_current
           FROM queue_session`,
        )
        .one();
      const receipt = state.storage.sql
        .exec<{
          actor_scope_hash: string;
          created_at: string;
          expires_at: string;
        }>(
          "SELECT actor_scope_hash, created_at, expires_at FROM command_receipts WHERE command_id = ?",
          command.commandId,
        )
        .one();
      const counts = state.storage.sql
        .exec<{ session_count: number; receipt_count: number }>(
          `SELECT
             (SELECT COUNT(*) FROM queue_session) AS session_count,
             (SELECT COUNT(*) FROM command_receipts) AS receipt_count`,
        )
        .one();
      return { session, receipt, counts };
    });

    expect(persisted.session).toMatchObject({
      session_id: opened.sessionId,
      queue_id: queueId,
      status: "OPEN",
      next_sequence: 25,
      is_current: 1,
    });
    expect(JSON.parse(persisted.session.config_snapshot_json)).toEqual(sessionConfig);
    expect(persisted.receipt.actor_scope_hash).not.toBe(command.actorScope);
    expect(
      Date.parse(persisted.receipt.expires_at) - Date.parse(persisted.receipt.created_at),
    ).toBe(24 * 60 * 60 * 1000);
    expect(persisted.counts).toEqual({ session_count: 1, receipt_count: 1 });

    const changedSnapshotReplay = await sendOpen({
      ...command,
      configSnapshot: { ...sessionConfig, prefix: "B" },
    });
    expect(changedSnapshotReplay.status).toBe(201);
    expect(await changedSnapshotReplay.json()).toEqual(opened);

    const retryWithoutCurrentConfig = await sendOpen({
      commandId: command.commandId,
      actorScope: command.actorScope,
      queueId,
    });
    expect(retryWithoutCurrentConfig.status).toBe(201);
    expect(await retryWithoutCurrentConfig.json()).toEqual(opened);

    const actorConflict = await sendOpen({ ...command, actorScope: "merchant-account-02" });
    expect(actorConflict.status).toBe(409);
    expect(await actorConflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const rejectedOpen = {
      ...command,
      commandId: "0f0d3191-5f2f-4f3b-a6a9-811d9d56e24d",
    };
    const [alreadyOpenResponse, rejectedRetryResponse] = await Promise.all([
      sendOpen(rejectedOpen),
      sendOpen(rejectedOpen),
    ]);
    expect(alreadyOpenResponse.status).toBe(409);
    const alreadyOpen = await alreadyOpenResponse.json();
    expect(alreadyOpen).toMatchObject({ error: { code: "QUEUE_SESSION_ACTIVE" } });
    expect(await rejectedRetryResponse.json()).toEqual(alreadyOpen);

    const wrongQueueResponse = await sendOpen({
      ...command,
      commandId: "203d56ef-dab0-467a-a08d-b4689b12a658",
      queueId: "different-queue",
    });
    expect(wrongQueueResponse.status).toBe(409);
    expect(await wrongQueueResponse.json()).toMatchObject({
      error: { code: "QUEUE_ID_MISMATCH" },
    });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE command_receipts SET expires_at = ? WHERE command_id = ?",
        "2000-01-01T00:00:00.000Z",
        command.commandId,
      );
    });
    const expiredRetry = await sendOpen(command);
    expect(expiredRetry.status).toBe(409);
    expect(await expiredRetry.json()).toMatchObject({
      error: { code: "QUEUE_SESSION_ACTIVE" },
    });
    const healthResponse = await stub.fetch("https://queue-do.test/_internal/health");
    expect(await healthResponse.json()).toMatchObject({ sessionCount: 1 });
  });

  it("allows only one session when distinct open commands race", async () => {
    const queueId = "queue-open-race-test";
    const stub = env.QUEUES.get(env.QUEUES.idFromName(queueId));
    const url = "https://queue-do.test/_internal/sessions/open";
    const sendOpen = (commandId: string) =>
      stub.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId,
          actorScope: "merchant-account-01",
          queueId,
          configSnapshot: sessionConfig,
        }),
      });

    const responses: Response[] = await Promise.all([
      sendOpen("4bb5166f-cc59-4601-9673-c284f4d035c0"),
      sendOpen("c8d48f26-af88-4857-95b7-17a8aff07152"),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejectedResponse = responses.find((response) => response.status === 409);
    expect(rejectedResponse).toBeDefined();
    expect(await rejectedResponse?.json()).toMatchObject({
      error: { code: "QUEUE_SESSION_ACTIVE" },
    });

    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ session_count: number; current_count: number; receipt_count: number }>(
          `SELECT
             (SELECT COUNT(*) FROM queue_session) AS session_count,
             (SELECT COUNT(*) FROM queue_session WHERE is_current = 1) AS current_count,
             (SELECT COUNT(*) FROM command_receipts) AS receipt_count`,
        )
        .one(),
    );
    expect(counts).toEqual({ session_count: 1, current_count: 1, receipt_count: 2 });
  });
});
