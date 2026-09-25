import { describe, expect, it } from "vitest";
import {
  estimateReturnWindow,
  estimateServiceDurationSeconds,
  MIN_HISTORY_SAMPLE_COUNT,
} from "../src/index.js";

const nowMilliseconds = 1_700_000_000_000;

describe("estimateServiceDurationSeconds", () => {
  it("uses the configured default until enough valid history exists", () => {
    expect(estimateServiceDurationSeconds(600, [120, 90, 60, 30])).toEqual({
      durationSeconds: 600,
      source: "CONFIGURED_DEFAULT",
    });
  });

  it("uses the median of at least five completed durations", () => {
    expect(estimateServiceDurationSeconds(600, [90, 60, 30, 120, 40])).toEqual({
      durationSeconds: 60,
      source: "HISTORY_MEDIAN",
    });
  });

  it("rounds an even-sample median to the nearest whole second", () => {
    expect(estimateServiceDurationSeconds(600, [10, 20, 30, 40, 50, 100])).toEqual({
      durationSeconds: 35,
      source: "HISTORY_MEDIAN",
    });
  });

  it("ignores invalid historical rows when checking the sample threshold", () => {
    expect(
      estimateServiceDurationSeconds(600, [
        30,
        40,
        50,
        60,
        Number.NaN,
        -1,
        Number.MAX_SAFE_INTEGER,
      ]),
    ).toEqual({
      durationSeconds: 600,
      source: "CONFIGURED_DEFAULT",
    });
    expect(MIN_HISTORY_SAMPLE_COUNT).toBe(5);
  });

  it("rejects an invalid configured default", () => {
    expect(() => estimateServiceDurationSeconds(0, [60, 60, 60, 60, 60])).toThrowError(
      expect.objectContaining({ code: "INVALID_ESTIMATE_INPUT" }),
    );
    expect(() => estimateServiceDurationSeconds(Number.MAX_SAFE_INTEGER, [])).toThrowError(
      expect.objectContaining({ code: "INVALID_ESTIMATE_INPUT" }),
    );
  });
});

describe("estimateReturnWindow", () => {
  it("schedules one service lane and applies a bounded uncertainty buffer", () => {
    const estimate = estimateReturnWindow({
      nowMilliseconds,
      serviceCapacity: 1,
      activeServices: [{ expectedDurationSeconds: 600, elapsedMilliseconds: 240_000 }],
      waitingAheadDurationsSeconds: [600],
      uncertaintyBufferSeconds: 300,
    });

    expect(estimate).toEqual({
      expectedStartAtMilliseconds: nowMilliseconds + 16 * 60_000,
      earliestReturnAtMilliseconds: nowMilliseconds + 11 * 60_000,
      latestReturnAtMilliseconds: nowMilliseconds + 21 * 60_000,
    });
  });

  it("assigns waiting tickets to the least-loaded service lane", () => {
    const estimate = estimateReturnWindow({
      nowMilliseconds,
      serviceCapacity: 2,
      activeServices: [{ expectedDurationSeconds: 600, elapsedMilliseconds: 120_000 }],
      waitingAheadDurationsSeconds: [180, 240],
      uncertaintyBufferSeconds: 0,
    });

    expect(estimate.expectedStartAtMilliseconds).toBe(nowMilliseconds + 7 * 60_000);
    expect(estimate.earliestReturnAtMilliseconds).toBe(estimate.expectedStartAtMilliseconds);
    expect(estimate.latestReturnAtMilliseconds).toBe(estimate.expectedStartAtMilliseconds);
  });

  it("clamps elapsed active work at zero remaining duration", () => {
    const estimate = estimateReturnWindow({
      nowMilliseconds,
      serviceCapacity: 1,
      activeServices: [{ expectedDurationSeconds: 600, elapsedMilliseconds: 900_000 }],
      waitingAheadDurationsSeconds: [],
      uncertaintyBufferSeconds: 0,
    });

    expect(estimate.expectedStartAtMilliseconds).toBe(nowMilliseconds);
  });

  it("rejects invalid capacity, excessive active work, and invalid durations", () => {
    expect(() =>
      estimateReturnWindow({
        nowMilliseconds,
        serviceCapacity: 0,
        activeServices: [],
        waitingAheadDurationsSeconds: [],
        uncertaintyBufferSeconds: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ESTIMATE_INPUT" }));

    expect(() =>
      estimateReturnWindow({
        nowMilliseconds,
        serviceCapacity: 1,
        activeServices: [
          { expectedDurationSeconds: 60, elapsedMilliseconds: 0 },
          { expectedDurationSeconds: 60, elapsedMilliseconds: 0 },
        ],
        waitingAheadDurationsSeconds: [],
        uncertaintyBufferSeconds: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ESTIMATE_INPUT" }));

    expect(() =>
      estimateReturnWindow({
        nowMilliseconds,
        serviceCapacity: 1,
        activeServices: [],
        waitingAheadDurationsSeconds: [Number.MAX_SAFE_INTEGER],
        uncertaintyBufferSeconds: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ESTIMATE_INPUT" }));
  });
});
