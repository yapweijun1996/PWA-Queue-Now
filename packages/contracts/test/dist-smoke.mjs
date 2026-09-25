import assert from "node:assert/strict";
import {
  CallNextRequestSchema,
  CallNextResponseSchema,
  JoinQueueRequestSchema,
  QueueChangedEventSchema,
} from "../dist/index.js";

assert.equal(
  JoinQueueRequestSchema.safeParse({
    joinRequestId: "e6a0180e-f189-4a6f-b254-3e2e03497b47",
    joinRecoverySecret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    serviceId: "service_01",
  }).success,
  true,
);
assert.equal(
  JoinQueueRequestSchema.safeParse({
    joinRequestId: "not-a-uuid",
    joinRecoverySecret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    serviceId: "service_01",
  }).success,
  false,
);
assert.equal(
  CallNextRequestSchema.safeParse({
    commandId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
  }).success,
  true,
);
assert.equal(
  CallNextResponseSchema.safeParse({
    sessionId: "e02b6ec4-53be-4d5c-a5f9-9d6cf86125dc",
    ticket: {
      ticketId: "ticket_01",
      displayNumber: "A025",
      serviceId: "service_01",
      lifecycleStatus: "CALLED",
      callCount: 1,
      calledAt: "2026-09-25T13:40:00Z",
      graceDeadline: "2026-09-25T13:45:00Z",
    },
    queueRevision: 2,
  }).success,
  true,
);
assert.equal(
  QueueChangedEventSchema.safeParse({
    type: "queue.changed",
    queueRevision: 1,
    occurredAt: "2026-09-25T13:40:00Z",
  }).success,
  true,
);
assert.equal(
  QueueChangedEventSchema.safeParse({
    type: "queue.changed",
    queueRevision: 1,
    occurredAt: "2026-09-25T13:40:00Z",
    payload: { ticketCapability: "must-not-be-broadcast" },
  }).success,
  false,
);
