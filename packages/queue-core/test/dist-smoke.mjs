import assert from "node:assert/strict";
import {
  calculateNextSequenceAllocation,
  formatDisplayNumber,
  transitionLifecycle,
} from "../dist/index.js";

assert.deepEqual(calculateNextSequenceAllocation(25), { sequenceNumber: 25, nextSequence: 26 });
assert.equal(formatDisplayNumber("A", 25), "A025");
assert.equal(transitionLifecycle(null, "JOIN", "CUSTOMER"), "WAITING");
assert.throws(() => transitionLifecycle("COMPLETED", "CALL", "STAFF"), {
  code: "INVALID_TRANSITION",
});
