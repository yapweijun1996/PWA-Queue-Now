import assert from "node:assert/strict";
import { transitionLifecycle } from "../dist/index.js";

assert.equal(transitionLifecycle(null, "JOIN", "CUSTOMER"), "WAITING");
assert.throws(() => transitionLifecycle("COMPLETED", "CALL", "STAFF"), {
  code: "INVALID_TRANSITION",
});
