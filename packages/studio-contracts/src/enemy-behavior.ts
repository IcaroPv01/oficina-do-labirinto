import { z } from "zod";
import { StudioIdSchema } from "./primitives.js";

const BehaviorStateIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

const SpeedMultiplierSchema = z.number().min(0.1).max(3);

const IdleMovementSchema = z
  .object({
    kind: z.literal("idle"),
    facePlayer: z.boolean(),
  })
  .strict();

const ChaseMovementSchema = z
  .object({
    kind: z.literal("chase"),
    speedMultiplier: SpeedMultiplierSchema,
    stopDistance: z.number().min(0).max(1_000),
    requireLineOfSight: z.boolean(),
  })
  .strict();

const FleeMovementSchema = z
  .object({
    kind: z.literal("flee"),
    speedMultiplier: SpeedMultiplierSchema,
    safeDistance: z.number().min(16).max(2_000),
  })
  .strict();

const OrbitMovementSchema = z
  .object({
    kind: z.literal("orbit"),
    speedMultiplier: SpeedMultiplierSchema,
    radius: z.number().min(16).max(1_000),
    clockwise: z.boolean(),
    radialCorrection: z.number().min(0).max(1),
  })
  .strict();

const WanderMovementSchema = z
  .object({
    kind: z.literal("wander"),
    speedMultiplier: SpeedMultiplierSchema,
    turnIntervalSeconds: z.number().min(0.1).max(20),
    leashRadius: z.number().min(16).max(2_000),
  })
  .strict();

const PatrolWaypointSchema = z
  .object({
    offsetX: z.number().min(-2_000).max(2_000),
    offsetY: z.number().min(-2_000).max(2_000),
    pauseSeconds: z.number().min(0).max(30),
  })
  .strict();

const PatrolMovementSchema = z
  .object({
    kind: z.literal("patrol"),
    speedMultiplier: SpeedMultiplierSchema,
    waypoints: z.array(PatrolWaypointSchema).min(2).max(16),
    loop: z.boolean(),
  })
  .strict()
  .superRefine((movement, context) => {
    const unique = new Set(
      movement.waypoints.map(
        (waypoint) => `${waypoint.offsetX}:${waypoint.offsetY}`,
      ),
    );
    if (unique.size !== movement.waypoints.length) {
      context.addIssue({
        code: "custom",
        path: ["waypoints"],
        message: "Patrol waypoints must be unique.",
      });
    }
  });

export const EnemyMovementSchema = z.discriminatedUnion("kind", [
  IdleMovementSchema,
  ChaseMovementSchema,
  FleeMovementSchema,
  OrbitMovementSchema,
  WanderMovementSchema,
  PatrolMovementSchema,
]);
export type EnemyMovement = z.infer<typeof EnemyMovementSchema>;

const AlwaysConditionSchema = z.object({ kind: z.literal("always") }).strict();

const ComparisonOperatorSchema = z.enum(["lt", "lte", "gt", "gte"]);

const DistanceConditionSchema = z
  .object({
    kind: z.literal("distance-to-player"),
    operator: ComparisonOperatorSchema,
    pixels: z.number().min(0).max(4_000),
  })
  .strict();

const HealthConditionSchema = z
  .object({
    kind: z.literal("health-ratio"),
    operator: ComparisonOperatorSchema,
    ratio: z.number().min(0).max(1),
  })
  .strict();

const ElapsedConditionSchema = z
  .object({
    kind: z.literal("state-elapsed"),
    seconds: z.number().min(0.05).max(120),
  })
  .strict();

const LineOfSightConditionSchema = z
  .object({
    kind: z.literal("line-of-sight"),
    visible: z.boolean(),
  })
  .strict();

const WasHitConditionSchema = z
  .object({
    kind: z.literal("was-hit"),
    withinSeconds: z.number().min(0.05).max(30),
  })
  .strict();

const ChanceConditionSchema = z
  .object({
    kind: z.literal("random-chance"),
    probability: z.number().gt(0).max(1),
    intervalSeconds: z.number().min(0.1).max(60),
  })
  .strict();

export const EnemyAtomicConditionSchema = z.discriminatedUnion("kind", [
  AlwaysConditionSchema,
  DistanceConditionSchema,
  HealthConditionSchema,
  ElapsedConditionSchema,
  LineOfSightConditionSchema,
  WasHitConditionSchema,
  ChanceConditionSchema,
]);
export type EnemyAtomicCondition = z.infer<
  typeof EnemyAtomicConditionSchema
>;

export const EnemyConditionGroupSchema = z
  .object({
    mode: z.enum(["all", "any"]),
    conditions: z.array(EnemyAtomicConditionSchema).min(1).max(8),
  })
  .strict()
  .superRefine((group, context) => {
    const alwaysIndex = group.conditions.findIndex(
      (condition) => condition.kind === "always",
    );
    if (alwaysIndex !== -1 && group.conditions.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["conditions", alwaysIndex],
        message: "The always condition must be the only condition in its group.",
      });
    }
  });
export type EnemyConditionGroup = z.infer<
  typeof EnemyConditionGroupSchema
>;

const EnemyBehaviorTransitionSchema = z
  .object({
    transitionId: StudioIdSchema,
    toStateId: BehaviorStateIdSchema,
    when: EnemyConditionGroupSchema,
  })
  .strict();

const EnemyBehaviorStateSchema = z
  .object({
    stateId: BehaviorStateIdSchema,
    movement: EnemyMovementSchema,
    transitions: z.array(EnemyBehaviorTransitionSchema).max(12),
  })
  .strict();

/**
 * A finite, declarative movement state machine. It contains no script source,
 * dynamic property access, network calls, or host commands, so AI output can be
 * validated before the game preview interprets it.
 */
export const EnemyBehaviorV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("enemy-behavior"),
    entryStateId: BehaviorStateIdSchema,
    states: z.array(EnemyBehaviorStateSchema).min(1).max(24),
  })
  .strict()
  .superRefine((behavior, context) => {
    const stateIds = new Set<string>();
    const transitionIds = new Set<string>();

    behavior.states.forEach((state, stateIndex) => {
      if (stateIds.has(state.stateId)) {
        context.addIssue({
          code: "custom",
          path: ["states", stateIndex, "stateId"],
          message: "Behavior state IDs must be unique.",
        });
      }
      stateIds.add(state.stateId);

      let unconditionalIndex = -1;
      state.transitions.forEach((transition, transitionIndex) => {
        if (transitionIds.has(transition.transitionId)) {
          context.addIssue({
            code: "custom",
            path: ["states", stateIndex, "transitions", transitionIndex, "transitionId"],
            message: "Behavior transition IDs must be unique.",
          });
        }
        transitionIds.add(transition.transitionId);

        if (transition.toStateId === state.stateId) {
          context.addIssue({
            code: "custom",
            path: ["states", stateIndex, "transitions", transitionIndex, "toStateId"],
            message: "Self transitions are not allowed.",
          });
        }

        if (transition.when.conditions[0]?.kind === "always") {
          if (unconditionalIndex !== -1) {
            context.addIssue({
              code: "custom",
              path: ["states", stateIndex, "transitions", transitionIndex, "when"],
              message: "A state can have at most one unconditional transition.",
            });
          }
          unconditionalIndex = transitionIndex;
        }
      });

      if (
        unconditionalIndex !== -1 &&
        unconditionalIndex !== state.transitions.length - 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["states", stateIndex, "transitions", unconditionalIndex],
          message: "An unconditional transition must be last.",
        });
      }
    });

    if (!stateIds.has(behavior.entryStateId)) {
      context.addIssue({
        code: "custom",
        path: ["entryStateId"],
        message: "The entry state must exist.",
      });
    }

    behavior.states.forEach((state, stateIndex) => {
      state.transitions.forEach((transition, transitionIndex) => {
        if (!stateIds.has(transition.toStateId)) {
          context.addIssue({
            code: "custom",
            path: ["states", stateIndex, "transitions", transitionIndex, "toStateId"],
            message: "A transition must target an existing state.",
          });
        }
      });
    });

    const reachable = new Set<string>();
    const pending = [behavior.entryStateId];
    const statesById = new Map(
      behavior.states.map((state) => [state.stateId, state] as const),
    );
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || reachable.has(current)) continue;
      reachable.add(current);
      const state = statesById.get(current);
      state?.transitions.forEach((transition) => {
        if (!reachable.has(transition.toStateId)) pending.push(transition.toStateId);
      });
    }

    behavior.states.forEach((state, stateIndex) => {
      if (!reachable.has(state.stateId)) {
        context.addIssue({
          code: "custom",
          path: ["states", stateIndex, "stateId"],
          message: "Every behavior state must be reachable from the entry state.",
        });
      }
    });
  });
export type EnemyBehaviorV1 = z.infer<typeof EnemyBehaviorV1Schema>;

export function parseEnemyBehaviorV1(value: unknown): EnemyBehaviorV1 {
  return EnemyBehaviorV1Schema.parse(value);
}
