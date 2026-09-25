import {
  type Actor,
  type LifecycleCommand,
  type LifecycleStatus,
  type PresenceStatus,
  QueueDomainError,
} from "./types.js";

const terminalStatuses = new Set<LifecycleStatus>(["COMPLETED", "CANCELLED", "EXPIRED"]);

const lifecycleTransitions: Record<
  LifecycleStatus,
  Partial<Record<LifecycleCommand, LifecycleStatus>>
> = {
  WAITING: {
    CALL: "CALLED",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
  },
  CALLED: {
    START: "SERVING",
    RECALL: "CALLED",
    SKIP: "SKIPPED",
    CANCEL: "CANCELLED",
  },
  SKIPPED: {
    RECALL: "CALLED",
    CANCEL: "CANCELLED",
  },
  SERVING: {
    COMPLETE: "COMPLETED",
  },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

const lifecycleTransitionActors: Record<
  LifecycleStatus,
  Partial<Record<LifecycleCommand, readonly Actor[]>>
> = {
  WAITING: {
    CALL: ["STAFF"],
    CANCEL: ["CUSTOMER", "STAFF"],
    EXPIRE: ["SYSTEM"],
  },
  CALLED: {
    START: ["STAFF"],
    RECALL: ["STAFF"],
    SKIP: ["STAFF"],
    CANCEL: ["STAFF"],
  },
  SKIPPED: {
    RECALL: ["STAFF"],
    CANCEL: ["STAFF"],
  },
  SERVING: {
    COMPLETE: ["STAFF"],
  },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

const presenceTransitions: Record<PresenceStatus, readonly PresenceStatus[]> = {
  UNKNOWN: ["AWAY", "NEARBY", "RETURNED"],
  AWAY: ["NEARBY", "RETURNED"],
  NEARBY: ["AWAY", "RETURNED"],
  RETURNED: ["AWAY", "NEARBY"],
};

export function transitionLifecycle(
  current: LifecycleStatus | null,
  command: LifecycleCommand,
  actor: Actor,
): LifecycleStatus {
  if (current === null) {
    if (command !== "JOIN") {
      throw new QueueDomainError("INVALID_TRANSITION", `Cannot ${command} before a ticket exists.`);
    }

    if (actor !== "CUSTOMER" && actor !== "SYSTEM") {
      throw new QueueDomainError("FORBIDDEN_ACTOR", `${actor} cannot JOIN a customer ticket.`);
    }

    return "WAITING";
  }

  const next = lifecycleTransitions[current][command];
  if (next === undefined) {
    throw new QueueDomainError(
      "INVALID_TRANSITION",
      `Cannot ${command} a ticket in ${current} state.`,
    );
  }

  if (!lifecycleTransitionActors[current][command]?.includes(actor)) {
    throw new QueueDomainError(
      "FORBIDDEN_ACTOR",
      `${actor} cannot ${command} a ${current} ticket.`,
    );
  }

  return next;
}

export function transitionPresence(
  lifecycle: LifecycleStatus,
  current: PresenceStatus,
  next: PresenceStatus,
  actor: Actor,
): PresenceStatus {
  if (actor !== "CUSTOMER") {
    throw new QueueDomainError("FORBIDDEN_ACTOR", `${actor} cannot change customer presence.`);
  }

  if (terminalStatuses.has(lifecycle)) {
    throw new QueueDomainError(
      "INVALID_TRANSITION",
      `Cannot change presence for a ${lifecycle} ticket.`,
    );
  }

  if (current === next) {
    return current;
  }

  if (!presenceTransitions[current].includes(next)) {
    throw new QueueDomainError(
      "INVALID_TRANSITION",
      `Cannot change presence from ${current} to ${next}.`,
    );
  }

  return next;
}
