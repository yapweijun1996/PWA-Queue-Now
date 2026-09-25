import { QueueDomainError } from "./types.js";

export const MIN_HISTORY_SAMPLE_COUNT = 5;

export interface ServiceDurationEstimate {
  readonly durationSeconds: number;
  readonly source: "CONFIGURED_DEFAULT" | "HISTORY_MEDIAN";
}

export interface ActiveServiceWork {
  readonly expectedDurationSeconds: number;
  readonly elapsedMilliseconds: number;
}

export interface EstimateReturnWindowInput {
  readonly nowMilliseconds: number;
  readonly serviceCapacity: number;
  readonly activeServices: readonly ActiveServiceWork[];
  readonly waitingAheadDurationsSeconds: readonly number[];
  readonly uncertaintyBufferSeconds: number;
}

export interface ReturnWindowEstimate {
  readonly expectedStartAtMilliseconds: number;
  readonly earliestReturnAtMilliseconds: number;
  readonly latestReturnAtMilliseconds: number;
}

export function estimateServiceDurationSeconds(
  configuredDurationSeconds: number,
  recentCompletedDurationsSeconds: readonly number[],
): ServiceDurationEstimate {
  if (!isValidDurationSeconds(configuredDurationSeconds)) {
    throw invalidEstimateInput("The configured service duration must be a positive safe integer.");
  }

  const validSamples = [...recentCompletedDurationsSeconds]
    .filter(isValidDurationSeconds)
    .sort((left, right) => left - right);

  if (validSamples.length < MIN_HISTORY_SAMPLE_COUNT) {
    return { durationSeconds: configuredDurationSeconds, source: "CONFIGURED_DEFAULT" };
  }

  const middle = Math.floor(validSamples.length / 2);
  const middleSample = validSamples[middle];
  if (middleSample === undefined) {
    throw invalidEstimateInput("The historical duration sample could not be read.");
  }

  let median = middleSample;
  if (validSamples.length % 2 === 0) {
    const lowerMiddleSample = validSamples[middle - 1];
    if (lowerMiddleSample === undefined) {
      throw invalidEstimateInput("The historical duration sample could not be read.");
    }
    median = Math.round(lowerMiddleSample + (middleSample - lowerMiddleSample) / 2);
  }

  return { durationSeconds: median, source: "HISTORY_MEDIAN" };
}

export function estimateReturnWindow(input: EstimateReturnWindowInput): ReturnWindowEstimate {
  if (!Number.isSafeInteger(input.nowMilliseconds) || input.nowMilliseconds < 0) {
    throw invalidEstimateInput("The estimate time must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(input.serviceCapacity) || input.serviceCapacity < 1) {
    throw invalidEstimateInput("Service capacity must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.uncertaintyBufferSeconds) || input.uncertaintyBufferSeconds < 0) {
    throw invalidEstimateInput("The uncertainty buffer must be a non-negative safe integer.");
  }
  if (input.activeServices.length > input.serviceCapacity) {
    throw invalidEstimateInput("Active services cannot exceed service capacity.");
  }

  const workloads = input.activeServices.map(({ expectedDurationSeconds, elapsedMilliseconds }) => {
    if (!isValidDurationSeconds(expectedDurationSeconds)) {
      throw invalidEstimateInput("Active service durations must be positive safe integers.");
    }
    if (!Number.isSafeInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
      throw invalidEstimateInput(
        "Active service elapsed time must be a non-negative safe integer.",
      );
    }

    const expectedDurationMilliseconds = expectedDurationSeconds * 1000;
    if (!Number.isSafeInteger(expectedDurationMilliseconds)) {
      throw invalidEstimateInput("An active service duration exceeds the safe calculation range.");
    }
    return Math.max(0, expectedDurationMilliseconds - elapsedMilliseconds);
  });

  const slotCount = Math.min(
    input.serviceCapacity,
    input.activeServices.length + input.waitingAheadDurationsSeconds.length + 1,
  );
  while (workloads.length < slotCount) {
    workloads.push(0);
  }

  for (const durationSeconds of input.waitingAheadDurationsSeconds) {
    if (!isValidDurationSeconds(durationSeconds)) {
      throw invalidEstimateInput("Waiting service durations must be positive safe integers.");
    }
    const durationMilliseconds = durationSeconds * 1000;
    if (!Number.isSafeInteger(durationMilliseconds)) {
      throw invalidEstimateInput("A waiting service duration exceeds the safe calculation range.");
    }

    const nextSlot = indexOfMinimum(workloads);
    const currentWorkload = workloads[nextSlot];
    if (currentWorkload === undefined) {
      throw invalidEstimateInput("A service lane workload could not be read.");
    }
    const nextWorkload = currentWorkload + durationMilliseconds;
    if (!Number.isSafeInteger(nextWorkload)) {
      throw invalidEstimateInput(
        "The projected queue workload exceeds the safe calculation range.",
      );
    }
    workloads[nextSlot] = nextWorkload;
  }

  const expectedWaitMilliseconds = minimum(workloads);
  const bufferMilliseconds = input.uncertaintyBufferSeconds * 1000;
  const lowerWaitMilliseconds = Math.max(0, expectedWaitMilliseconds - bufferMilliseconds);
  const expectedStartAtMilliseconds = input.nowMilliseconds + expectedWaitMilliseconds;
  const earliestReturnAtMilliseconds = input.nowMilliseconds + lowerWaitMilliseconds;
  const latestReturnAtMilliseconds =
    input.nowMilliseconds + expectedWaitMilliseconds + bufferMilliseconds;

  if (
    !Number.isSafeInteger(bufferMilliseconds) ||
    !isValidDateMilliseconds(expectedStartAtMilliseconds) ||
    !isValidDateMilliseconds(earliestReturnAtMilliseconds) ||
    !isValidDateMilliseconds(latestReturnAtMilliseconds)
  ) {
    throw invalidEstimateInput("The return window exceeds the supported date range.");
  }

  return {
    expectedStartAtMilliseconds,
    earliestReturnAtMilliseconds,
    latestReturnAtMilliseconds,
  };
}

function indexOfMinimum(values: readonly number[]): number {
  const initialValue = values[0];
  if (initialValue === undefined) {
    throw invalidEstimateInput("At least one service lane is required.");
  }

  let minimumIndex = 0;
  let minimumValue = initialValue;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw invalidEstimateInput("A service lane workload could not be read.");
    }
    if (value < minimumValue) {
      minimumIndex = index;
      minimumValue = value;
    }
  }
  return minimumIndex;
}

function minimum(values: readonly number[]): number {
  const value = values[indexOfMinimum(values)];
  if (value === undefined) {
    throw invalidEstimateInput("A service lane workload could not be read.");
  }
  return value;
}

function isValidDurationSeconds(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 1000);
}

function isValidDateMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function invalidEstimateInput(message: string): QueueDomainError {
  return new QueueDomainError("INVALID_ESTIMATE_INPUT", message);
}
