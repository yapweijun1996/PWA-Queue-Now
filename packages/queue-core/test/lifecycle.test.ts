import { describe, expect, it } from "vitest";
import {
  lifecycleStatuses,
  type Actor,
  type LifecycleCommand,
  type LifecycleStatus,
  transitionLifecycle,
} from "../src/index.js";

interface LegalTransition {
  from: LifecycleStatus | null;
  command: LifecycleCommand;
  actors: readonly Actor[];
  to: LifecycleStatus;
}

const legalTransitions: readonly LegalTransition[] = [
  { from: null, command: "JOIN", actors: ["CUSTOMER", "SYSTEM"], to: "WAITING" },
  { from: "WAITING", command: "CALL", actors: ["STAFF"], to: "CALLED" },
  { from: "WAITING", command: "CANCEL", actors: ["CUSTOMER", "STAFF"], to: "CANCELLED" },
  { from: "WAITING", command: "EXPIRE", actors: ["SYSTEM"], to: "EXPIRED" },
  { from: "CALLED", command: "START", actors: ["STAFF"], to: "SERVING" },
  { from: "CALLED", command: "RECALL", actors: ["STAFF"], to: "CALLED" },
  { from: "CALLED", command: "SKIP", actors: ["STAFF"], to: "SKIPPED" },
  { from: "CALLED", command: "CANCEL", actors: ["STAFF"], to: "CANCELLED" },
  { from: "SKIPPED", command: "RECALL", actors: ["STAFF"], to: "CALLED" },
  { from: "SKIPPED", command: "CANCEL", actors: ["STAFF"], to: "CANCELLED" },
  { from: "SERVING", command: "COMPLETE", actors: ["STAFF"], to: "COMPLETED" },
];

const commands: readonly LifecycleCommand[] = [
  "JOIN",
  "CALL",
  "CANCEL",
  "EXPIRE",
  "START",
  "RECALL",
  "SKIP",
  "COMPLETE",
];
const actors: readonly Actor[] = ["CUSTOMER", "STAFF", "SYSTEM"];
const states: readonly (LifecycleStatus | null)[] = [null, ...lifecycleStatuses];

describe("transitionLifecycle", () => {
  it.each(
    legalTransitions.flatMap((transition) =>
      transition.actors.map((actor) => ({ ...transition, actor })),
    ),
  )("allows $actor to $command from $from to $to", ({ from, command, actor, to }) => {
    expect(transitionLifecycle(from, command, actor)).toBe(to);
  });

  it.each(
    states.flatMap((from) =>
      commands.flatMap((command) =>
        actors
          .filter(
            (actor) =>
              !legalTransitions.some(
                (transition) =>
                  transition.from === from &&
                  transition.command === command &&
                  transition.actors.includes(actor),
              ),
          )
          .map((actor) => ({ from, command, actor })),
      ),
    ),
  )("rejects $actor $command from $from", ({ from, command, actor }) => {
    const legalEdgeExists = legalTransitions.some(
      (transition) => transition.from === from && transition.command === command,
    );
    const expectedCode = legalEdgeExists ? "FORBIDDEN_ACTOR" : "INVALID_TRANSITION";

    expect(() => transitionLifecycle(from, command, actor)).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });
});
