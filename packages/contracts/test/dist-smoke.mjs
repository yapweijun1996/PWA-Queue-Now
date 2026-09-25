import assert from "node:assert/strict";
import { JoinQueueRequestSchema } from "../dist/index.js";

assert.equal(
  JoinQueueRequestSchema.safeParse({
    joinRequestId: "e6a0180e-f189-4a6f-b254-3e2e03497b47",
    serviceId: "service_01",
  }).success,
  true,
);
assert.equal(
  JoinQueueRequestSchema.safeParse({
    joinRequestId: "not-a-uuid",
    serviceId: "service_01",
  }).success,
  false,
);
