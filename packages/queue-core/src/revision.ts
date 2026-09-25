import { QueueDomainError } from "./types.js";
import type { QueueRevision } from "./types.js";

export function advanceQueueRevision(currentRevision: number): QueueRevision {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    throw new QueueDomainError(
      "INVALID_REVISION",
      "The current queue revision must be a non-negative safe integer.",
    );
  }

  if (currentRevision === Number.MAX_SAFE_INTEGER) {
    throw new QueueDomainError(
      "INVALID_REVISION",
      "The queue revision cannot be incremented safely.",
    );
  }

  return currentRevision + 1;
}
