import { describe, expect, it } from "vitest";
import { EnemyBehaviorV1Schema } from "./enemy-behavior.js";
import { VALID_BEHAVIOR } from "./test-fixtures.js";

function cloneBehavior(): Record<string, any> {
  return JSON.parse(JSON.stringify(VALID_BEHAVIOR)) as Record<string, any>;
}

describe("enemy behavior DSL v1", () => {
  it("accepts a reachable declarative movement state machine", () => {
    expect(EnemyBehaviorV1Schema.parse(VALID_BEHAVIOR)).toEqual(VALID_BEHAVIOR);
  });

  it("has no escape hatch for scripts or arbitrary commands", () => {
    const invalid = cloneBehavior();
    invalid.script = "fetch('https://example.test')";
    expect(EnemyBehaviorV1Schema.safeParse(invalid).success).toBe(false);

    const invalidMovement = cloneBehavior();
    invalidMovement.states[0].movement = {
      kind: "script",
      source: "process.exit()",
    };
    expect(EnemyBehaviorV1Schema.safeParse(invalidMovement).success).toBe(false);
  });

  it("requires unique states and transitions", () => {
    const duplicateState = cloneBehavior();
    duplicateState.states[1].stateId = "patrol";
    expect(EnemyBehaviorV1Schema.safeParse(duplicateState).success).toBe(false);

    const duplicateTransition = cloneBehavior();
    duplicateTransition.states[1].transitions[0].transitionId =
      "transition-chase";
    expect(EnemyBehaviorV1Schema.safeParse(duplicateTransition).success).toBe(
      false,
    );
  });

  it("rejects missing entry states and unknown transition targets", () => {
    expect(
      EnemyBehaviorV1Schema.safeParse({
        ...VALID_BEHAVIOR,
        entryStateId: "missing",
      }).success,
    ).toBe(false);

    const invalid = cloneBehavior();
    invalid.states[0].transitions[0].toStateId = "missing";
    expect(EnemyBehaviorV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unreachable states and self transitions", () => {
    const unreachable = cloneBehavior();
    unreachable.states[1].transitions = [];
    unreachable.states[0].transitions = [];
    expect(EnemyBehaviorV1Schema.safeParse(unreachable).success).toBe(false);

    const selfTransition = cloneBehavior();
    selfTransition.states[0].transitions[0].toStateId = "patrol";
    expect(EnemyBehaviorV1Schema.safeParse(selfTransition).success).toBe(false);
  });

  it("allows an unconditional transition only by itself and at lowest priority", () => {
    const mixedGroup = cloneBehavior();
    mixedGroup.states[0].transitions[0].when.conditions.push({ kind: "always" });
    expect(EnemyBehaviorV1Schema.safeParse(mixedGroup).success).toBe(false);

    const wrongPriority = cloneBehavior();
    wrongPriority.states[1].transitions[0].when.conditions = [{ kind: "always" }];
    expect(EnemyBehaviorV1Schema.safeParse(wrongPriority).success).toBe(false);
  });

  it("rejects duplicate patrol waypoints and out-of-range movement values", () => {
    const duplicateWaypoint = cloneBehavior();
    duplicateWaypoint.states[0].movement.waypoints[1] =
      duplicateWaypoint.states[0].movement.waypoints[0];
    expect(EnemyBehaviorV1Schema.safeParse(duplicateWaypoint).success).toBe(
      false,
    );

    const tooFast = cloneBehavior();
    tooFast.states[1].movement.speedMultiplier = 10;
    expect(EnemyBehaviorV1Schema.safeParse(tooFast).success).toBe(false);
  });
});
