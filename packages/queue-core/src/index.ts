export { advanceQueueRevision } from "./revision.js";
export {
  estimateReturnWindow,
  estimateServiceDurationSeconds,
  MIN_HISTORY_SAMPLE_COUNT,
  type ActiveServiceWork,
  type EstimateReturnWindowInput,
  type ReturnWindowEstimate,
  type ServiceDurationEstimate,
} from "./return-window.js";
export {
  resolveCommandReceipt,
  type CommandReceipt,
  type CommandReceiptResolution,
  type CommandRequestIdentity,
} from "./idempotency.js";
export {
  calculateNextSequenceAllocation,
  formatDisplayNumber,
  type SequenceAllocation,
} from "./sequence.js";
export { transitionLifecycle, transitionPresence } from "./transitions.js";
export {
  lifecycleStatuses,
  presenceStatuses,
  QueueDomainError,
  type Actor,
  type LifecycleCommand,
  type LifecycleStatus,
  type PresenceStatus,
  type QueueDomainErrorCode,
} from "./types.js";
