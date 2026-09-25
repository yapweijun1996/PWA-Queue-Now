export { lifecycleStatuses, presenceStatuses } from "@queuenow/contracts/domain";
export type {
  Actor,
  LifecycleCommand,
  LifecycleStatus,
  PresenceStatus,
} from "@queuenow/contracts/domain";

export type QueueDomainErrorCode = "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" | "INVALID_SEQUENCE";

export class QueueDomainError extends Error {
  constructor(
    readonly code: QueueDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueueDomainError";
  }
}
