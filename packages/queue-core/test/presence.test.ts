import { describe, expect, it } from "vitest";
import {
  lifecycleStatuses,
  presenceStatuses,
  type Actor,
  type LifecycleStatus,
  type PresenceStatus,
  transitionPresence,
} from "../src/index.js";

const terminalStatuses = new Set<LifecycleStatus>(["COMPLETED", "CANCELLED", "EXPIRED"]);
const actors: readonly Actor[] = ["CUSTOMER", "STAFF", "SYSTEM"];
const allowedTransitions: Record<PresenceStatus, readonly PresenceStatus[]> = {
  UNKNOWN: ["AWAY", "NEARBY", "RETURNED"],
  AWAY: ["NEARBY", "RETURNED"],
  NEARBY: ["AWAY", "RETURNED"],
  RETURNED: ["AWAY", "NEARBY"],
};

const cases = lifecycleStatuses.flatMap((lifecycle) =>
  presenceStatuses.flatMap((current) =>
    presenceStatuses.flatMap((next) =>
      actors.map((actor) => ({ lifecycle, current, next, actor })),
    ),
  ),
);

describe("transitionPresence", () => {
  it.each(cases)("checks $actor changing $lifecycle $current to $next", (testCase) => {
    const { lifecycle, current, next, actor } = testCase;

    if (actor !== "CUSTOMER") {
      expect(() => transitionPresence(lifecycle, current, next, actor)).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN_ACTOR" }),
      );
      return;
    }

    if (terminalStatuses.has(lifecycle)) {
      expect(() => transitionPresence(lifecycle, current, next, actor)).toThrowError(
        expect.objectContaining({ code: "INVALID_TRANSITION" }),
      );
      return;
    }

    const transitionIsValid = current === next || allowedTransitions[current].includes(next);
    if (!transitionIsValid) {
      expect(() => transitionPresence(lifecycle, current, next, actor)).toThrowError(
        expect.objectContaining({ code: "INVALID_TRANSITION" }),
      );
      return;
    }

    expect(transitionPresence(lifecycle, current, next, actor)).toBe(next);
  });

  it("treats setting the current presence as a no-op", () => {
    const current: PresenceStatus = "NEARBY";

    expect(transitionPresence("WAITING", current, current, "CUSTOMER")).toBe(current);
  });
});
