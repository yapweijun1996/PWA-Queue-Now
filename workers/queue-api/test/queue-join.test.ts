import { JoinQueueResponseSchema } from "@queuenow/contracts";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
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

const recoverySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const otherRecoverySecret = "A".repeat(43);
const openUrl = "https://queue-do.test/_internal/sessions/open";
const joinUrl = "https://queue-do.test/_internal/tickets/join";

describe("atomic anonymous join runtime", () => {
  it("persists an encrypted recovery receipt and replays only with the correct proof", async () => {
    const queueId = "queue-join-idempotency-test";
    const stub = await openQueue(queueId);
    const command = {
      joinRequestId: "69ea98d3-9a5b-47ec-9eb2-268496aef87f",
      joinRecoverySecret: recoverySecret,
      serviceId: "service_01",
    };

    const firstResponse = await sendJoin(stub, queueId, command);
    expect(firstResponse.status).toBe(201);
    const firstResult = JoinQueueResponseSchema.parse(await firstResponse.json());
    expect(firstResult).toMatchObject({
      ticket: {
        displayNumber: "A025",
        lifecycleStatus: "WAITING",
        presenceStatus: "UNKNOWN",
        peopleAhead: 0,
        queueRevision: 1,
      },
    });
    expect(
      Date.parse(firstResult.ticket.returnWindow.to) -
        Date.parse(firstResult.ticket.returnWindow.from),
    ).toBe(300_000);
    expect(firstResult.ticketCapability).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

    const exactRetry = await sendJoin(stub, queueId, command);
    expect(exactRetry.status).toBe(201);
    expect(await exactRetry.json()).toEqual(firstResult);

    const idOnlyAttempt = await stub.fetch(joinUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queueId,
        joinRequestId: command.joinRequestId,
        serviceId: command.serviceId,
      }),
    });
    expect(idOnlyAttempt.status).toBe(400);
    expect(await idOnlyAttempt.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });

    const wrongProof = await sendJoin(stub, queueId, {
      ...command,
      joinRecoverySecret: otherRecoverySecret,
    });
    expect(wrongProof.status).toBe(403);
    expect(await wrongProof.json()).toEqual({
      error: { code: "JOIN_RECOVERY_INVALID", message: "The join recovery proof is invalid." },
    });

    const changedIntent = await sendJoin(stub, queueId, {
      ...command,
      serviceId: "service_02",
    });
    expect(changedIntent.status).toBe(409);
    expect(await changedIntent.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    const changedQueue = await sendJoin(stub, "another-queue", command);
    expect(changedQueue.status).toBe(409);
    expect(await changedQueue.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const persisted = await runInDurableObject(stub, (_instance, state) => {
      const ticket = state.storage.sql
        .exec<{
          capability_hash: string;
          last_mutation_revision: number;
        }>(
          "SELECT capability_hash, last_mutation_revision FROM tickets WHERE ticket_id = ?",
          firstResult.ticket.ticketId,
        )
        .one();
      const receipt = state.storage.sql
        .exec<{
          safe_result_json: string;
          ticket_capability_envelope_json: string;
          request_fingerprint: string;
        }>(
          "SELECT safe_result_json, ticket_capability_envelope_json, request_fingerprint FROM join_receipts WHERE join_request_id = ?",
          command.joinRequestId,
        )
        .one();
      const event = state.storage.sql
        .exec<{ queue_revision: number; safe_payload_json: string }>(
          "SELECT queue_revision, safe_payload_json FROM events WHERE ticket_id = ?",
          firstResult.ticket.ticketId,
        )
        .one();
      const stateCounts = state.storage.sql
        .exec<{ ticket_count: number; receipt_count: number; event_count: number }>(
          `SELECT
             (SELECT COUNT(*) FROM tickets) AS ticket_count,
             (SELECT COUNT(*) FROM join_receipts) AS receipt_count,
             (SELECT COUNT(*) FROM events) AS event_count`,
        )
        .one();
      const session = state.storage.sql
        .exec<{ next_sequence: number; queue_revision: number }>(
          "SELECT next_sequence, queue_revision FROM queue_session WHERE is_current = 1",
        )
        .one();
      return { ticket, receipt, event, stateCounts, session };
    });

    expect(persisted.ticket.capability_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.ticket.capability_hash).not.toBe(firstResult.ticketCapability);
    expect(persisted.ticket.last_mutation_revision).toBe(1);
    expect(persisted.receipt.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const safeResult = JSON.parse(persisted.receipt.safe_result_json);
    expect(safeResult.ticket).toEqual(firstResult.ticket);
    expect(safeResult).not.toHaveProperty("ticketCapability");
    expect(persisted.receipt.safe_result_json).not.toContain(recoverySecret);
    expect(persisted.receipt.safe_result_json).not.toContain(firstResult.ticketCapability);
    expect(persisted.receipt.ticket_capability_envelope_json).not.toContain(
      firstResult.ticketCapability,
    );
    expect(persisted.receipt.ticket_capability_envelope_json).not.toContain(recoverySecret);
    expect(persisted.event.queue_revision).toBe(1);
    expect(persisted.event.safe_payload_json).not.toContain(recoverySecret);
    expect(persisted.event.safe_payload_json).not.toContain(firstResult.ticketCapability);
    expect(persisted.stateCounts).toEqual({ ticket_count: 1, receipt_count: 1, event_count: 1 });
    expect(persisted.session).toEqual({ next_sequence: 26, queue_revision: 1 });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE tickets SET capability_hash = ? WHERE ticket_id = ?",
        "f".repeat(64),
        firstResult.ticket.ticketId,
      );
    });
    const corruptedReceipt = await sendJoin(stub, queueId, command);
    expect(corruptedReceipt.status).toBe(500);
    expect(await corruptedReceipt.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "The stored join result is unavailable." },
    });
  });

  it("allocates unique ticket numbers and revisions for 50 concurrent joins", async () => {
    const queueId = "queue-join-concurrency-test";
    const stub = await openQueue(queueId);
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        sendJoin(stub, queueId, {
          joinRequestId: uuidFromCounter(index + 1),
          joinRecoverySecret: generateRecoverySecret(),
          serviceId: "service_01",
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 50 }, () => 201),
    );
    const results = await Promise.all(
      responses.map(async (response) => JoinQueueResponseSchema.parse(await response.json())),
    );
    const sequenceNumbers = results
      .map((result) => Number(result.ticket.displayNumber.slice(1)))
      .sort((left, right) => left - right);
    const revisions = results
      .map((result) => result.ticket.queueRevision)
      .sort((left, right) => left - right);
    const ticketIds = results.map((result) => result.ticket.ticketId);

    expect(sequenceNumbers).toEqual(Array.from({ length: 50 }, (_, index) => index + 25));
    expect(revisions).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(new Set(ticketIds).size).toBe(50);

    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{
          ticket_count: number;
          receipt_count: number;
          event_count: number;
          next_sequence: number;
          queue_revision: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM tickets) AS ticket_count,
             (SELECT COUNT(*) FROM join_receipts) AS receipt_count,
             (SELECT COUNT(*) FROM events) AS event_count,
             (SELECT next_sequence FROM queue_session WHERE is_current = 1) AS next_sequence,
             (SELECT queue_revision FROM queue_session WHERE is_current = 1) AS queue_revision`,
        )
        .one(),
    );
    expect(counts).toEqual({
      ticket_count: 50,
      receipt_count: 50,
      event_count: 50,
      next_sequence: 75,
      queue_revision: 50,
    });
  });

  it("replays concurrent duplicates without consuming another number or revision", async () => {
    const queueId = "queue-join-duplicate-race-test";
    const stub = await openQueue(queueId);
    const command = {
      joinRequestId: "4bb5166f-cc59-4601-9673-c284f4d035c0",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => sendJoin(stub, queueId, command)),
    );

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 8 }, () => 201),
    );
    const results = await Promise.all(
      responses.map(async (response) => JoinQueueResponseSchema.parse(await response.json())),
    );
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }

    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{
          ticket_count: number;
          receipt_count: number;
          event_count: number;
          next_sequence: number;
          queue_revision: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM tickets) AS ticket_count,
             (SELECT COUNT(*) FROM join_receipts) AS receipt_count,
             (SELECT COUNT(*) FROM events) AS event_count,
             (SELECT next_sequence FROM queue_session WHERE is_current = 1) AS next_sequence,
             (SELECT queue_revision FROM queue_session WHERE is_current = 1) AS queue_revision`,
        )
        .one(),
    );
    expect(counts).toEqual({
      ticket_count: 1,
      receipt_count: 1,
      event_count: 1,
      next_sequence: 26,
      queue_revision: 1,
    });
  });

  it("rolls back every partial write when sequence or revision counters are exhausted", async () => {
    const sequenceQueueId = "queue-join-sequence-exhaustion-test";
    const sequenceStub = await openQueue(sequenceQueueId);
    await runInDurableObject(sequenceStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE queue_session SET next_sequence = ? WHERE is_current = 1",
        Number.MAX_SAFE_INTEGER,
      );
    });
    const sequenceFailure = await sendJoin(sequenceStub, sequenceQueueId, {
      joinRequestId: "20b41f65-d64b-45a6-b98a-70dc7d06a909",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    });
    expect(sequenceFailure.status).toBe(409);
    expect(await sequenceFailure.json()).toMatchObject({
      error: { code: "QUEUE_SEQUENCE_EXHAUSTED" },
    });
    const sequenceState = await readJoinCounts(sequenceStub);
    expect(sequenceState).toEqual({
      ticket_count: 0,
      receipt_count: 0,
      event_count: 0,
      next_sequence: Number.MAX_SAFE_INTEGER,
      queue_revision: 0,
    });

    const revisionQueueId = "queue-join-revision-exhaustion-test";
    const revisionStub = await openQueue(revisionQueueId);
    await runInDurableObject(revisionStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE queue_session SET queue_revision = ? WHERE is_current = 1",
        Number.MAX_SAFE_INTEGER,
      );
    });
    const revisionFailure = await sendJoin(revisionStub, revisionQueueId, {
      joinRequestId: "d6d4aa9b-a4f6-4495-8c50-8c466d5fe113",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    });
    expect(revisionFailure.status).toBe(409);
    expect(await revisionFailure.json()).toMatchObject({
      error: { code: "QUEUE_REVISION_EXHAUSTED" },
    });
    const revisionState = await readJoinCounts(revisionStub);
    expect(revisionState).toEqual({
      ticket_count: 0,
      receipt_count: 0,
      event_count: 0,
      next_sequence: 25,
      queue_revision: Number.MAX_SAFE_INTEGER,
    });
  });

  it("scopes event revisions to a queue session when a queue is reopened", async () => {
    const queueId = "queue-join-reopen-session-test";
    const stub = await openQueue(queueId);
    const firstCommand = {
      joinRequestId: "1a3c9a28-2d0c-45d0-9c1f-c709e3db861f",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    };
    const firstJoin = await sendJoin(stub, queueId, firstCommand);
    expect(firstJoin.status).toBe(201);
    const firstResult = JoinQueueResponseSchema.parse(await firstJoin.json());

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE queue_session SET status = 'CLOSED', is_current = 0, closed_at = ? WHERE is_current = 1",
        new Date().toISOString(),
      );
    });
    const reopenedStub = await openQueue(queueId, "ed4eeb63-f570-44d0-b4de-93417a542405");
    const oldJoinRetry = await sendJoin(reopenedStub, queueId, firstCommand);
    expect(oldJoinRetry.status).toBe(201);
    expect(await oldJoinRetry.json()).toEqual(firstResult);

    const secondJoin = await sendJoin(reopenedStub, queueId, {
      joinRequestId: "cf5796f6-8a5c-4602-a99a-23cd6a639e18",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    });
    expect(secondJoin.status).toBe(201);
    const secondResult = JoinQueueResponseSchema.parse(await secondJoin.json());
    expect(secondResult.ticket.queueRevision).toBe(1);

    const eventRows = await runInDurableObject(reopenedStub, (_instance, state) =>
      state.storage.sql
        .exec<{ session_id: string; queue_revision: number }>(
          "SELECT session_id, queue_revision FROM events ORDER BY rowid ASC",
        )
        .toArray(),
    );
    expect(eventRows).toHaveLength(2);
    expect(eventRows.map((event) => event.queue_revision)).toEqual([1, 1]);
    expect(new Set(eventRows.map((event) => event.session_id)).size).toBe(2);
  });

  it("fails closed when the queue is paused, closed, or the service is invalid", async () => {
    const queueId = "queue-join-state-test";
    const stub = await openQueue(queueId);

    const invalidService = await sendJoin(stub, queueId, {
      joinRequestId: "b86b5c97-06a8-4ea8-857f-1d5343d30b09",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "unknown-service",
    });
    expect(invalidService.status).toBe(400);
    expect(await invalidService.json()).toMatchObject({ error: { code: "INVALID_SERVICE" } });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE queue_session SET status = 'PAUSED' WHERE is_current = 1");
    });
    const paused = await sendJoin(stub, queueId, {
      joinRequestId: "f147581d-6658-4bf4-9c3b-a1f2bd1efb5c",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    });
    expect(paused.status).toBe(409);
    expect(await paused.json()).toMatchObject({ error: { code: "QUEUE_PAUSED" } });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE queue_session SET status = 'CLOSED', is_current = 0, closed_at = ? WHERE is_current = 1",
        new Date().toISOString(),
      );
    });
    const closed = await sendJoin(stub, queueId, {
      joinRequestId: "9d6b1e14-b744-44b4-9af0-c267c9f7d204",
      joinRecoverySecret: generateRecoverySecret(),
      serviceId: "service_01",
    });
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: { code: "QUEUE_CLOSED" } });

    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ ticket_count: number; receipt_count: number; event_count: number }>(
          `SELECT
             (SELECT COUNT(*) FROM tickets) AS ticket_count,
             (SELECT COUNT(*) FROM join_receipts) AS receipt_count,
             (SELECT COUNT(*) FROM events) AS event_count`,
        )
        .one(),
    );
    expect(counts).toEqual({ ticket_count: 0, receipt_count: 0, event_count: 0 });
  });
});

async function openQueue(queueId: string, commandId = "f907d0da-7b16-4a47-9f40-2ef7085e30f2") {
  const stub = env.QUEUES.get(env.QUEUES.idFromName(queueId));
  const response = await stub.fetch(openUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId,
      actorScope: "merchant-account-01",
      queueId,
      configSnapshot: sessionConfig,
    }),
  });
  expect(response.status).toBe(201);
  return stub;
}

async function readJoinCounts(stub: DurableObjectStub) {
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{
        ticket_count: number;
        receipt_count: number;
        event_count: number;
        next_sequence: number;
        queue_revision: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM tickets) AS ticket_count,
           (SELECT COUNT(*) FROM join_receipts) AS receipt_count,
           (SELECT COUNT(*) FROM events) AS event_count,
           (SELECT next_sequence FROM queue_session WHERE is_current = 1) AS next_sequence,
           (SELECT queue_revision FROM queue_session WHERE is_current = 1) AS queue_revision`,
      )
      .one(),
  );
}

function sendJoin(
  stub: DurableObjectStub,
  queueId: string,
  command: { joinRequestId: string; joinRecoverySecret: string; serviceId: string },
): Promise<Response> {
  return stub.fetch(joinUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queueId, ...command }),
  });
}

function uuidFromCounter(counter: number): string {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function generateRecoverySecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
