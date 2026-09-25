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

export const queueStatuses = ["OPEN", "PAUSED", "CLOSED"] as const;

export type QueueStatus = (typeof queueStatuses)[number];
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
