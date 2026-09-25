import {
  CallNextErrorResponseSchema,
  CallNextResponseSchema,
  OpenQueueSessionResponseSchema,
} from "@queuenow/contracts";
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

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function queueStub(queueId: string) {
  return env.QUEUES.get(env.QUEUES.idFromName(queueId));
}

async function openQueue(
  stub: ReturnType<typeof queueStub>,
  queueId: string,
  commandId = uuid(1),
  config = sessionConfig,
): Promise<{ sessionId: string }> {
  const response = await stub.fetch("https://queue-do.test/_internal/sessions/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId,
      actorScope: "merchant-account-01",
      queueId,
      configSnapshot: config,
    }),
  });
  expect(response.status).toBe(201);
  const opened = OpenQueueSessionResponseSchema.parse(await response.json());
  return { sessionId: opened.sessionId };
}

async function joinTicket(
  stub: ReturnType<typeof queueStub>,
  queueId: string,
  index: number,
): Promise<{ ticketId: string; displayNumber: string }> {
  const response = await stub.fetch("https://queue-do.test/_internal/tickets/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queueId,
      joinRequestId: uuid(1_000 + index),
      joinRecoverySecret: recoverySecret,
      serviceId: "service_01",
    }),
  });
  expect(response.status).toBe(201);
  const result = (await response.json()) as {
    ticket: { ticketId: string; displayNumber: string };
  };
  return result.ticket;
}

function sendCallNext(
  stub: ReturnType<typeof queueStub>,
  queueId: string,
  commandId: string,
  actorScope = "staff-account-01",
): Promise<Response> {
  return stub.fetch("https://queue-do.test/_internal/queue/call-next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId, actorScope, queueId }),
  });
}

describe("atomic Call Next Durable Object command", () => {
  it("calls strict FIFO, persists a revision/event, and replays exact concurrent retries", async () => {
    const queueId = "queue-call-next-fifo-test";
    const stub = queueStub(queueId);
    const { sessionId } = await openQueue(stub, queueId);
    const tickets = [];
    for (let index = 0; index < 3; index += 1) {
      tickets.push(await joinTicket(stub, queueId, index));
    }
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE queue_session SET status = 'PAUSED' WHERE is_current = 1");
    });

    const commandId = uuid(2_000);
    const [firstResponse, retryResponse] = await Promise.all([
      sendCallNext(stub, queueId, commandId),
      sendCallNext(stub, queueId, commandId),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    const firstResult = CallNextResponseSchema.parse(await firstResponse.json());
    expect(await retryResponse.json()).toEqual(firstResult);
    expect(firstResult).toMatchObject({
      sessionId,
      ticket: {
        ticketId: tickets[0]?.ticketId,
        displayNumber: "A025",
        serviceId: "service_01",
        lifecycleStatus: "CALLED",
        callCount: 1,
      },
      queueRevision: 4,
    });

    const calledAt = Date.parse(firstResult.ticket.calledAt);
    const graceDeadline = Date.parse(firstResult.ticket.graceDeadline);
    expect(graceDeadline - calledAt).toBe(300_000);

    const changedActorRetry = await sendCallNext(stub, queueId, commandId, "staff-account-02");
    expect(changedActorRetry.status).toBe(409);
    expect(await changedActorRetry.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const secondResponse = await sendCallNext(stub, queueId, uuid(2_001));
    expect(secondResponse.status).toBe(200);
    expect(CallNextResponseSchema.parse(await secondResponse.json())).toMatchObject({
      ticket: { ticketId: tickets[1]?.ticketId, displayNumber: "A026", callCount: 1 },
      queueRevision: 5,
    });

    const persisted = await runInDurableObject(stub, (_instance, state) => {
      const session = state.storage.sql
        .exec<{ status: string; queue_revision: number }>(
          "SELECT status, queue_revision FROM queue_session WHERE is_current = 1",
        )
        .one();
      const storedTickets = state.storage.sql
        .exec<{
          ticket_id: string;
          lifecycle_status: string;
          call_count: number;
          last_mutation_revision: number;
        }>(
          `SELECT ticket_id, lifecycle_status, call_count, last_mutation_revision
           FROM tickets WHERE session_id = (SELECT session_id FROM queue_session WHERE is_current = 1)
           ORDER BY sequence_number ASC`,
        )
        .toArray();
      const events = state.storage.sql
        .exec<{
          queue_revision: number;
          event_type: string;
          actor_type: string;
          actor_id: string | null;
          safe_payload_json: string;
        }>(
          "SELECT queue_revision, event_type, actor_type, actor_id, safe_payload_json FROM events ORDER BY queue_revision",
        )
        .toArray();
      const callReceipt = state.storage.sql
        .exec<{ actor_scope_hash: string; result_revision: number; receipt_count: number }>(
          `SELECT actor_scope_hash, result_revision,
                  (SELECT COUNT(*) FROM command_receipts WHERE command_type = 'CALL_NEXT') AS receipt_count
           FROM command_receipts WHERE command_id = ?`,
          commandId,
        )
        .one();
      return { session, storedTickets, events, callReceipt };
    });

    expect(persisted.session).toEqual({ status: "PAUSED", queue_revision: 5 });
    expect(persisted.storedTickets.map((ticket) => ticket.lifecycle_status)).toEqual([
      "CALLED",
      "CALLED",
      "WAITING",
    ]);
    expect(persisted.storedTickets.map((ticket) => ticket.last_mutation_revision)).toEqual([
      4, 5, 3,
    ]);
    expect(persisted.events.map((event) => event.queue_revision)).toEqual([1, 2, 3, 4, 5]);
    expect(persisted.events.slice(3).map((event) => event.event_type)).toEqual([
      "TICKET_CALLED",
      "TICKET_CALLED",
    ]);
    expect(persisted.events.slice(3).every((event) => event.actor_type === "MERCHANT")).toBe(true);
    expect(persisted.events.slice(3).every((event) => event.actor_id === "staff-account-01")).toBe(
      true,
    );
    expect(JSON.parse(persisted.events[3]?.safe_payload_json ?? "{}")).toEqual({
      displayNumber: "A025",
    });
    expect(persisted.callReceipt.actor_scope_hash).not.toBe("staff-account-01");
    expect(persisted.callReceipt.result_revision).toBe(4);
    expect(persisted.callReceipt.receipt_count).toBe(2);
  });

  it("stores a no-waiting rejection so an exact retry cannot call a later ticket", async () => {
    const queueId = "queue-call-next-empty-test";
    const stub = queueStub(queueId);
    await openQueue(stub, queueId);
    const commandId = uuid(3_000);

    const initialResponse = await sendCallNext(stub, queueId, commandId);
    expect(initialResponse.status).toBe(409);
    const initialBody = CallNextErrorResponseSchema.parse(await initialResponse.json());
    expect(initialBody).toMatchObject({ error: { code: "NO_WAITING_TICKETS" } });

    const ticket = await joinTicket(stub, queueId, 0);
    const exactRetry = await sendCallNext(stub, queueId, commandId);
    expect(exactRetry.status).toBe(409);
    expect(await exactRetry.json()).toEqual(initialBody);

    const newCommand = await sendCallNext(stub, queueId, uuid(3_001));
    expect(newCommand.status).toBe(200);
    expect(CallNextResponseSchema.parse(await newCommand.json())).toMatchObject({
      ticket: { ticketId: ticket.ticketId, displayNumber: ticket.displayNumber },
      queueRevision: 2,
    });

    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ queue_revision: number; event_count: number; call_count: number }>(
          `SELECT queue_revision,
                  (SELECT COUNT(*) FROM events) AS event_count,
                  (SELECT COUNT(*) FROM command_receipts WHERE command_type = 'CALL_NEXT') AS call_count
           FROM queue_session WHERE is_current = 1`,
        )
        .one(),
    );
    expect(counts).toEqual({ queue_revision: 2, event_count: 2, call_count: 2 });
  });

  it("rejects command IDs already used by a different command type", async () => {
    const queueId = "queue-call-next-command-type-test";
    const stub = queueStub(queueId);
    const sharedCommandId = uuid(4_000);
    await openQueue(stub, queueId, sharedCommandId);

    const response = await sendCallNext(stub, queueId, sharedCommandId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("fails closed when a queue revision or ticket call counter cannot advance", async () => {
    const revisionQueueId = "queue-call-next-revision-overflow-test";
    const revisionStub = queueStub(revisionQueueId);
    await openQueue(revisionStub, revisionQueueId);
    await joinTicket(revisionStub, revisionQueueId, 0);
    await runInDurableObject(revisionStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE queue_session SET queue_revision = ? WHERE is_current = 1",
        Number.MAX_SAFE_INTEGER,
      );
    });

    const revisionCommandId = uuid(4_500);
    const revisionResponse = await sendCallNext(revisionStub, revisionQueueId, revisionCommandId);
    expect(revisionResponse.status).toBe(409);
    expect(await revisionResponse.json()).toMatchObject({
      error: { code: "QUEUE_REVISION_EXHAUSTED" },
    });
    const revisionState = await runInDurableObject(revisionStub, (_instance, state) =>
      state.storage.sql
        .exec<{
          queue_revision: number;
          lifecycle_status: string;
          event_count: number;
          call_receipt_count: number;
        }>(
          `SELECT queue_revision,
                  (SELECT lifecycle_status FROM tickets LIMIT 1) AS lifecycle_status,
                  (SELECT COUNT(*) FROM events) AS event_count,
                  (SELECT COUNT(*) FROM command_receipts WHERE command_id = ?) AS call_receipt_count
           FROM queue_session WHERE is_current = 1`,
          revisionCommandId,
        )
        .one(),
    );
    expect(revisionState).toEqual({
      queue_revision: Number.MAX_SAFE_INTEGER,
      lifecycle_status: "WAITING",
      event_count: 1,
      call_receipt_count: 0,
    });

    const counterQueueId = "queue-call-next-counter-overflow-test";
    const counterStub = queueStub(counterQueueId);
    await openQueue(counterStub, counterQueueId);
    await joinTicket(counterStub, counterQueueId, 0);
    await runInDurableObject(counterStub, (_instance, state) => {
      state.storage.sql.exec("UPDATE tickets SET call_count = ?", Number.MAX_SAFE_INTEGER);
    });

    const counterResponse = await sendCallNext(counterStub, counterQueueId, uuid(4_501));
    expect(counterResponse.status).toBe(409);
    expect(await counterResponse.json()).toMatchObject({
      error: { code: "QUEUE_CALL_COUNT_EXHAUSTED" },
    });
    const counterState = await runInDurableObject(counterStub, (_instance, state) =>
      state.storage.sql
        .exec<{
          queue_revision: number;
          lifecycle_status: string;
          call_count: number;
          event_count: number;
        }>(
          `SELECT queue_revision,
                  (SELECT lifecycle_status FROM tickets LIMIT 1) AS lifecycle_status,
                  (SELECT call_count FROM tickets LIMIT 1) AS call_count,
                  (SELECT COUNT(*) FROM events) AS event_count
           FROM queue_session WHERE is_current = 1`,
        )
        .one(),
    );
    expect(counterState).toEqual({
      queue_revision: 1,
      lifecycle_status: "WAITING",
      call_count: Number.MAX_SAFE_INTEGER,
      event_count: 1,
    });
  });

  it("fails closed when the session grace deadline exceeds the shared timestamp contract", async () => {
    const queueId = "queue-call-next-invalid-grace-test";
    const stub = queueStub(queueId);
    await openQueue(stub, queueId, uuid(4_600), {
      ...sessionConfig,
      gracePeriodSeconds: Number.MAX_SAFE_INTEGER,
    });
    await joinTicket(stub, queueId, 0);

    const response = await sendCallNext(stub, queueId, uuid(4_601));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "QUEUE_CONFIG_INVALID" },
    });
    const state = await runInDurableObject(stub, (_instance, durableObjectState) =>
      durableObjectState.storage.sql
        .exec<{
          queue_revision: number;
          lifecycle_status: string;
          called_at: string | null;
          event_count: number;
          call_receipt_count: number;
        }>(
          `SELECT queue_revision,
                  (SELECT lifecycle_status FROM tickets LIMIT 1) AS lifecycle_status,
                  (SELECT called_at FROM tickets LIMIT 1) AS called_at,
                  (SELECT COUNT(*) FROM events) AS event_count,
                  (SELECT COUNT(*) FROM command_receipts WHERE command_type = 'CALL_NEXT') AS call_receipt_count
           FROM queue_session WHERE is_current = 1`,
        )
        .one(),
    );
    expect(state).toEqual({
      queue_revision: 1,
      lifecycle_status: "WAITING",
      called_at: null,
      event_count: 1,
      call_receipt_count: 0,
    });
  });

  it("serializes concurrent Call Next commands without selecting any ticket twice", async () => {
    const queueId = "queue-call-next-race-test";
    const stub = queueStub(queueId);
    await openQueue(stub, queueId);
    const tickets = [];
    for (let index = 0; index < 24; index += 1) {
      tickets.push(await joinTicket(stub, queueId, index));
    }

    const responses = await Promise.all(
      Array.from({ length: 36 }, (_unused, index) =>
        sendCallNext(stub, queueId, uuid(5_000 + index)),
      ),
    );
    const results = await Promise.all(
      responses.map(async (response) => {
        if (response.status === 200) {
          return {
            kind: "accepted" as const,
            body: CallNextResponseSchema.parse(await response.json()),
          };
        }
        return {
          kind: "rejected" as const,
          status: response.status,
          body: CallNextErrorResponseSchema.parse(await response.json()),
        };
      }),
    );
    const accepted = results.filter((result) => result.kind === "accepted");
    const rejected = results.filter((result) => result.kind === "rejected");
    const selectedTicketIds = accepted.map((result) => result.body.ticket.ticketId);
    const selectedNumbers = accepted.map((result) => result.body.ticket.displayNumber).sort();

    expect(accepted).toHaveLength(24);
    expect(rejected).toHaveLength(12);
    expect(rejected.every((result) => result.status === 409)).toBe(true);
    expect(new Set(selectedTicketIds).size).toBe(24);
    expect(selectedNumbers).toEqual(tickets.map((ticket) => ticket.displayNumber).sort());
    expect(rejected.every((result) => result.body.error.code === "NO_WAITING_TICKETS")).toBe(true);

    const state = await runInDurableObject(stub, (_instance, durableObjectState) => {
      const session = durableObjectState.storage.sql
        .exec<{ queue_revision: number }>(
          "SELECT queue_revision FROM queue_session WHERE is_current = 1",
        )
        .one();
      const called = durableObjectState.storage.sql
        .exec<{ ticket_id: string; sequence_number: number; call_count: number }>(
          `SELECT ticket_id, sequence_number, call_count FROM tickets
           WHERE lifecycle_status = 'CALLED' ORDER BY sequence_number`,
        )
        .toArray();
      const events = durableObjectState.storage.sql
        .exec<{ queue_revision: number; event_type: string }>(
          "SELECT queue_revision, event_type FROM events ORDER BY queue_revision",
        )
        .toArray();
      const callReceiptCount = durableObjectState.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM command_receipts WHERE command_type = 'CALL_NEXT'",
        )
        .one().count;
      return { session, called, events, callReceiptCount };
    });

    expect(state.session.queue_revision).toBe(48);
    expect(state.called).toHaveLength(24);
    expect(state.called.every((ticket) => ticket.call_count === 1)).toBe(true);
    expect(state.events).toHaveLength(48);
    expect(state.events.map((event) => event.queue_revision)).toEqual(
      Array.from({ length: 48 }, (_unused, index) => index + 1),
    );
    expect(state.events.slice(24).every((event) => event.event_type === "TICKET_CALLED")).toBe(
      true,
    );
    expect(state.callReceiptCount).toBe(36);
  });
});
