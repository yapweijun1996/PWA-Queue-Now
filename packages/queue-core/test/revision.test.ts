import { describe, expect, it } from "vitest";
import { advanceQueueRevision } from "../src/index.js";

const invalidRevisions = [
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
];

describe("advanceQueueRevision", () => {
  it.each([0, 1, 42, Number.MAX_SAFE_INTEGER - 1])(
    "increments valid revision %s exactly once",
    (currentRevision) => {
      expect(advanceQueueRevision(currentRevision)).toBe(currentRevision + 1);
    },
  );

  it.each([...invalidRevisions, Number.MAX_SAFE_INTEGER])(
    "rejects invalid or exhausted revision %s",
    (currentRevision) => {
      expect(() => advanceQueueRevision(currentRevision)).toThrowError(
        expect.objectContaining({ code: "INVALID_REVISION" }),
      );
    },
  );
});
