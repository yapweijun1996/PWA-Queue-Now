export { lifecycleStatuses, presenceStatuses } from "@queuenow/contracts/domain";
export type {
  Actor,
  LifecycleCommand,
  LifecycleStatus,
  PresenceStatus,
} from "@queuenow/contracts/domain";
export type { QueueRevision } from "@queuenow/contracts";

export type QueueDomainErrorCode =
  | "INVALID_TRANSITION"
  | "FORBIDDEN_ACTOR"
  | "INVALID_SEQUENCE"
  | "INVALID_REVISION";

export class QueueDomainError extends Error {
  constructor(
    readonly code: QueueDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueueDomainError";
  }
}
