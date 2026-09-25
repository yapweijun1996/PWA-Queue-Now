export const lifecycleStatuses = [
  "WAITING",
  "CALLED",
  "SERVING",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type LifecycleStatus = (typeof lifecycleStatuses)[number];

export const presenceStatuses = ["UNKNOWN", "AWAY", "NEARBY", "RETURNED"] as const;

export type PresenceStatus = (typeof presenceStatuses)[number];
export type Actor = "CUSTOMER" | "STAFF" | "SYSTEM";

export type LifecycleCommand =
  | "JOIN"
  | "CALL"
  | "CANCEL"
  | "EXPIRE"
  | "START"
  | "RECALL"
  | "SKIP"
  | "COMPLETE";

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
