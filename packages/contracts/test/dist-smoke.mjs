import assert from "node:assert/strict";
import { JoinQueueRequestSchema, QueueChangedEventSchema } from "../dist/index.js";

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
