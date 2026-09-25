import { QueueDomainError } from "./types.js";

export interface SequenceAllocation {
  readonly sequenceNumber: number;
  readonly nextSequence: number;
}

export function calculateNextSequenceAllocation(nextSequence: number): SequenceAllocation {
  if (
    !Number.isSafeInteger(nextSequence) ||
    nextSequence < 1 ||
    nextSequence >= Number.MAX_SAFE_INTEGER
  ) {
    throw new QueueDomainError(
      "INVALID_SEQUENCE",
      "The next sequence must be positive and leave room for a safe counter increment.",
    );
  }

  return {
    sequenceNumber: nextSequence,
    nextSequence: nextSequence + 1,
  };
}

export function formatDisplayNumber(prefix: string, sequenceNumber: number): string {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new QueueDomainError(
      "INVALID_SEQUENCE",
      "The sequence number must be a safe positive integer.",
    );
  }

  return `${prefix}${String(sequenceNumber).padStart(3, "0")}`;
}
