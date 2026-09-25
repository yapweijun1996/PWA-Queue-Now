import { describe, expect, it } from "vitest";
import {
  resolveCommandReceipt,
  type CommandReceipt,
  type CommandRequestIdentity,
} from "../src/index.js";

const request: CommandRequestIdentity = {
  commandId: "02f8fcd6-3d5a-4e10-ae40-2f5a90e8a223",
  actorScope: "staff_01",
  commandType: "CALL_NEXT",
  requestFingerprint: "sha256:request-digest",
};

const storedReceipt: CommandReceipt<{ accepted: boolean; revision: number }> = {
  ...request,
  result: { accepted: true, revision: 18 },
};

const conflictingRequests: Array<[string, CommandRequestIdentity]> = [
  ["command ID", { ...request, commandId: "another-command-id" }],
  ["actor scope", { ...request, actorScope: "staff_02" }],
  ["command type", { ...request, commandType: "SKIP_TICKET" }],
  ["request fingerprint", { ...request, requestFingerprint: "sha256:other-digest" }],
];

describe("resolveCommandReceipt", () => {
  it("allows execution when no prior receipt exists", () => {
    expect(resolveCommandReceipt(null, request)).toEqual({ kind: "execute" });
  });

  it("replays the original result for an exact retry", () => {
    expect(resolveCommandReceipt(storedReceipt, request)).toEqual({
      kind: "replay",
      result: storedReceipt.result,
    });
  });

  it.each(conflictingRequests)("fails closed when the %s differs", (_field, retry) => {
    expect(() => resolveCommandReceipt(storedReceipt, retry)).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
    );
  });
});
