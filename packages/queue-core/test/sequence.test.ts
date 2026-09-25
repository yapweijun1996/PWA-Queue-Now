import { describe, expect, it } from "vitest";
import { calculateNextSequenceAllocation, formatDisplayNumber } from "../src/index.js";

const invalidSequences = [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
];
const invalidNextSequences = [...invalidSequences, Number.MAX_SAFE_INTEGER];

describe("calculateNextSequenceAllocation", () => {
  it.each([1, 25, 999])("allocates %i and advances exactly once", (nextSequence) => {
    expect(calculateNextSequenceAllocation(nextSequence)).toEqual({
      sequenceNumber: nextSequence,
      nextSequence: nextSequence + 1,
    });
  });

  it("allocates contiguous values when the returned counter is carried forward", () => {
    const first = calculateNextSequenceAllocation(25);
    const second = calculateNextSequenceAllocation(first.nextSequence);

    expect([first.sequenceNumber, second.sequenceNumber]).toEqual([25, 26]);
  });

  it("allows the largest sequence that leaves a safe next counter", () => {
    const nextSequence = Number.MAX_SAFE_INTEGER - 1;

    expect(calculateNextSequenceAllocation(nextSequence)).toEqual({
      sequenceNumber: nextSequence,
      nextSequence: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each(invalidNextSequences)("rejects invalid next sequence %s", (nextSequence) => {
    expect(() => calculateNextSequenceAllocation(nextSequence)).toThrowError(
      expect.objectContaining({ code: "INVALID_SEQUENCE" }),
    );
  });
});

describe("formatDisplayNumber", () => {
  it.each([
    ["A", 1, "A001"],
    ["A", 25, "A025"],
    ["A", 999, "A999"],
    ["A", 1000, "A1000"],
  ] as const)("formats prefix %s and sequence %i", (prefix, sequenceNumber, expected) => {
    expect(formatDisplayNumber(prefix, sequenceNumber)).toBe(expected);
  });

  it("formats the largest safe sequence without truncation", () => {
    const sequenceNumber = Number.MAX_SAFE_INTEGER;

    expect(formatDisplayNumber("A", sequenceNumber)).toBe(`A${sequenceNumber}`);
  });

  it.each(invalidSequences)("rejects invalid display sequence %s", (sequenceNumber) => {
    expect(() => formatDisplayNumber("A", sequenceNumber)).toThrowError(
      expect.objectContaining({ code: "INVALID_SEQUENCE" }),
    );
  });
});
