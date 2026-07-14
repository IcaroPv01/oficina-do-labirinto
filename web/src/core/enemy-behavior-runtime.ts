import type {
  EnemyAtomicCondition,
  EnemyBehaviorV1,
  EnemyConditionGroup,
  EnemyMovement,
} from "@collaborative-roguelike/studio-contracts";
import { hashSeed, nextRandom } from "./rng";

/**
 * Runtime v1 limitations:
 * - the room has only its outer rectangular walls, so LOS has no inner occluders;
 * - `facePlayer` updates serialized facing, but the current renderer has no facing art;
 * - wander leashes and patrol offsets are anchored at the enemy's spawn position;
 * - behavior changes movement only; damage still comes from legacy contact/projectiles;
 * - patrol advances at most one waypoint and transitions at most one state per tick.
 */
const TIME_EPSILON_SECONDS = 1e-9;
const MAX_STEP_SECONDS = 0.05;

export interface EnemyBehaviorRandomCheckState {
  readonly transitionId: string;
  readonly conditionIndex: number;
  readonly nextRollAtSeconds: number;
  readonly value: boolean;
}

export type EnemyBehaviorMovementRuntime =
  | { readonly kind: "simple" }
  | {
      readonly kind: "wander";
      readonly headingX: number;
      readonly headingY: number;
      readonly nextTurnAtSeconds: number;
    }
  | {
      readonly kind: "patrol";
      readonly waypointIndex: number;
      readonly pauseRemainingSeconds: number;
      readonly completed: boolean;
    };

/** Plain JSON state persisted beside one enemy; it contains no executable data. */
export interface EnemyBehaviorRuntimeState {
  readonly stateId: string;
  readonly stateElapsedSeconds: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly encounterMaxHealth: number;
  readonly lastHitAtSeconds: number | null;
  readonly facingX: number;
  readonly facingY: number;
  readonly rngState: number;
  readonly movement: EnemyBehaviorMovementRuntime;
  readonly randomChecks: readonly EnemyBehaviorRandomCheckState[];
}

export interface EnemyBehaviorEntitySnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly health: number;
}

export interface EnemyBehaviorWorld {
  readonly width: number;
  readonly height: number;
  readonly wallThickness: number;
}

export interface CreateEnemyBehaviorRuntimeOptions {
  readonly simulationSeed: string;
  readonly enemyId: number;
  readonly x: number;
  readonly y: number;
  readonly encounterMaxHealth: number;
}

export interface StepEnemyBehaviorMovementOptions {
  readonly behavior: EnemyBehaviorV1;
  readonly runtime: EnemyBehaviorRuntimeState;
  readonly enemy: EnemyBehaviorEntitySnapshot;
  readonly player: { readonly x: number; readonly y: number };
  readonly baseSpeed: number;
  readonly enemyRadius: number;
  readonly deltaSeconds: number;
  readonly world: EnemyBehaviorWorld;
}

export interface EnemyBehaviorMovementResult {
  readonly x: number;
  readonly y: number;
  readonly runtime: EnemyBehaviorRuntimeState;
}

export interface ResolveEnemyBehaviorTransitionsOptions {
  readonly behavior: EnemyBehaviorV1;
  readonly runtime: EnemyBehaviorRuntimeState;
  readonly enemy: EnemyBehaviorEntitySnapshot;
  readonly player: { readonly x: number; readonly y: number };
  readonly nowSeconds: number;
  readonly world: EnemyBehaviorWorld;
}

type BehaviorState = EnemyBehaviorV1["states"][number];

/**
 * Initializes local behavior RNG from simulation seed and enemy ID. Behavior
 * randomness therefore cannot perturb the simulation RNG used by loot drops.
 */
export function createEnemyBehaviorRuntime(
  behavior: EnemyBehaviorV1,
  options: CreateEnemyBehaviorRuntimeOptions,
): EnemyBehaviorRuntimeState {
  const entryState = stateById(behavior, behavior.entryStateId);
  const base: EnemyBehaviorRuntimeState = {
    stateId: entryState.stateId,
    stateElapsedSeconds: 0,
    spawnX: options.x,
    spawnY: options.y,
    encounterMaxHealth: Math.max(1, options.encounterMaxHealth),
    lastHitAtSeconds: null,
    facingX: 0,
    facingY: 0,
    rngState: hashSeed(
      `${options.simulationSeed}:enemy:${options.enemyId}:behavior:v1`,
    ),
    movement: { kind: "simple" },
    randomChecks: [],
  };
  return enterState(base, entryState);
}

/** Resets stale serialized state safely if its state ID no longer exists. */
export function ensureEnemyBehaviorRuntime(
  behavior: EnemyBehaviorV1,
  runtime: EnemyBehaviorRuntimeState | undefined,
  options: CreateEnemyBehaviorRuntimeOptions,
): EnemyBehaviorRuntimeState {
  if (runtime === undefined) {
    return createEnemyBehaviorRuntime(behavior, options);
  }
  if (behavior.states.some((state) => state.stateId === runtime.stateId)) {
    return runtime;
  }
  return enterState(runtime, stateById(behavior, behavior.entryStateId));
}

/**
 * Applies only the current state's movement. Transitions are resolved after
 * collision handling so `was-hit` can observe an impact in the same tick.
 */
export function stepEnemyBehaviorMovement(
  options: StepEnemyBehaviorMovementOptions,
): EnemyBehaviorMovementResult {
  const deltaSeconds = clamp(options.deltaSeconds, 0, MAX_STEP_SECONDS);
  const state = stateById(options.behavior, options.runtime.stateId);
  const elapsedRuntime: EnemyBehaviorRuntimeState = {
    ...options.runtime,
    stateElapsedSeconds: options.runtime.stateElapsedSeconds + deltaSeconds,
  };

  if (deltaSeconds === 0) {
    return {
      x: options.enemy.x,
      y: options.enemy.y,
      runtime: elapsedRuntime,
    };
  }

  return applyMovement(state.movement, elapsedRuntime, options, deltaSeconds);
}

/** Marks a non-lethal projectile hit before transition conditions are read. */
export function markEnemyBehaviorHit(
  runtime: EnemyBehaviorRuntimeState,
  nowSeconds: number,
): EnemyBehaviorRuntimeState {
  return {
    ...runtime,
    lastHitAtSeconds: nowSeconds,
  };
}

/**
 * Refreshes interval-cached random conditions, then takes at most the first
 * matching transition. The destination starts moving on the following tick.
 */
export function resolveEnemyBehaviorTransitions(
  options: ResolveEnemyBehaviorTransitionsOptions,
): EnemyBehaviorRuntimeState {
  const state = stateById(options.behavior, options.runtime.stateId);
  const refreshed = refreshRandomChecks(state, options.runtime);
  const transition = state.transitions.find((candidate) =>
    conditionGroupMatches(candidate.when, candidate.transitionId, refreshed, options),
  );

  if (transition === undefined) {
    return refreshed;
  }

  return enterState(
    refreshed,
    stateById(options.behavior, transition.toStateId),
  );
}

/**
 * The current room has no internal obstacles. Since its walkable rectangle is
 * convex, LOS exists exactly when both finite centers are inside that rectangle.
 */
export function hasRectangularLineOfSight(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  world: EnemyBehaviorWorld,
): boolean {
  const minimum = world.wallThickness;
  const maximumX = world.width - world.wallThickness;
  const maximumY = world.height - world.wallThickness;
  return (
    pointIsFinite(from) &&
    pointIsFinite(to) &&
    pointInside(from, minimum, maximumX, maximumY) &&
    pointInside(to, minimum, maximumX, maximumY)
  );
}

function enterState(
  previous: EnemyBehaviorRuntimeState,
  state: BehaviorState,
): EnemyBehaviorRuntimeState {
  let rngState = previous.rngState;
  let movement: EnemyBehaviorMovementRuntime = { kind: "simple" };

  if (state.movement.kind === "wander") {
    const heading = randomHeading(rngState);
    rngState = heading.rngState;
    movement = {
      kind: "wander",
      headingX: heading.x,
      headingY: heading.y,
      nextTurnAtSeconds: state.movement.turnIntervalSeconds,
    };
  } else if (state.movement.kind === "patrol") {
    movement = {
      kind: "patrol",
      waypointIndex: 0,
      pauseRemainingSeconds: 0,
      completed: false,
    };
  }

  const initializedChecks = initializeRandomChecks(state, rngState);
  return {
    ...previous,
    stateId: state.stateId,
    stateElapsedSeconds: 0,
    rngState: initializedChecks.rngState,
    movement,
    randomChecks: initializedChecks.checks,
  };
}

function initializeRandomChecks(
  state: BehaviorState,
  initialRngState: number,
): {
  readonly checks: readonly EnemyBehaviorRandomCheckState[];
  readonly rngState: number;
} {
  let rngState = initialRngState;
  const checks: EnemyBehaviorRandomCheckState[] = [];
  for (const transition of state.transitions) {
    transition.when.conditions.forEach((condition, conditionIndex) => {
      if (condition.kind !== "random-chance") return;
      const roll = nextRandom(rngState);
      rngState = roll.state;
      checks.push({
        transitionId: transition.transitionId,
        conditionIndex,
        nextRollAtSeconds: condition.intervalSeconds,
        value: roll.value < condition.probability,
      });
    });
  }
  return { checks, rngState };
}

function refreshRandomChecks(
  state: BehaviorState,
  runtime: EnemyBehaviorRuntimeState,
): EnemyBehaviorRuntimeState {
  let rngState = runtime.rngState;
  const conditionsByKey = randomConditionsByKey(state);
  const randomChecks = runtime.randomChecks.map((check) => {
    const condition = conditionsByKey.get(randomCheckKey(check));
    if (
      condition === undefined ||
      runtime.stateElapsedSeconds + TIME_EPSILON_SECONDS <
        check.nextRollAtSeconds
    ) {
      return check;
    }
    const roll = nextRandom(rngState);
    rngState = roll.state;
    return {
      ...check,
      nextRollAtSeconds:
        check.nextRollAtSeconds + condition.intervalSeconds,
      value: roll.value < condition.probability,
    };
  });
  return { ...runtime, rngState, randomChecks };
}

function randomConditionsByKey(
  state: BehaviorState,
): ReadonlyMap<string, Extract<EnemyAtomicCondition, { kind: "random-chance" }>> {
  const result = new Map<
    string,
    Extract<EnemyAtomicCondition, { kind: "random-chance" }>
  >();
  for (const transition of state.transitions) {
    transition.when.conditions.forEach((condition, conditionIndex) => {
      if (condition.kind === "random-chance") {
        result.set(
          `${transition.transitionId}:${conditionIndex}`,
          condition,
        );
      }
    });
  }
  return result;
}

function randomCheckKey(check: EnemyBehaviorRandomCheckState): string {
  return `${check.transitionId}:${check.conditionIndex}`;
}

function conditionGroupMatches(
  group: EnemyConditionGroup,
  transitionId: string,
  runtime: EnemyBehaviorRuntimeState,
  options: ResolveEnemyBehaviorTransitionsOptions,
): boolean {
  const results = group.conditions.map((condition, conditionIndex) =>
    conditionMatches(
      condition,
      transitionId,
      conditionIndex,
      runtime,
      options,
    ),
  );
  return group.mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

function conditionMatches(
  condition: EnemyAtomicCondition,
  transitionId: string,
  conditionIndex: number,
  runtime: EnemyBehaviorRuntimeState,
  options: ResolveEnemyBehaviorTransitionsOptions,
): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "distance-to-player":
      return compare(
        distance(options.enemy, options.player),
        condition.operator,
        condition.pixels,
      );
    case "health-ratio":
      return compare(
        options.enemy.health / runtime.encounterMaxHealth,
        condition.operator,
        condition.ratio,
      );
    case "state-elapsed":
      return (
        runtime.stateElapsedSeconds + TIME_EPSILON_SECONDS >= condition.seconds
      );
    case "line-of-sight":
      return (
        hasRectangularLineOfSight(
          options.enemy,
          options.player,
          options.world,
        ) === condition.visible
      );
    case "was-hit":
      return (
        runtime.lastHitAtSeconds !== null &&
        options.nowSeconds - runtime.lastHitAtSeconds <=
          condition.withinSeconds + TIME_EPSILON_SECONDS
      );
    case "random-chance":
      return (
        runtime.randomChecks.find(
          (check) =>
            check.transitionId === transitionId &&
            check.conditionIndex === conditionIndex,
        )?.value ?? false
      );
  }
}

function applyMovement(
  movement: EnemyMovement,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  switch (movement.kind) {
    case "idle":
      return idleMovement(movement.facePlayer, runtime, options);
    case "chase":
      return chaseMovement(movement, runtime, options, deltaSeconds);
    case "flee":
      return fleeMovement(movement, runtime, options, deltaSeconds);
    case "orbit":
      return orbitMovement(movement, runtime, options, deltaSeconds);
    case "wander":
      return wanderMovement(movement, runtime, options, deltaSeconds);
    case "patrol":
      return patrolMovement(movement, runtime, options, deltaSeconds);
  }
}

function idleMovement(
  facePlayer: boolean,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
): EnemyBehaviorMovementResult {
  const facing = facePlayer
    ? unitDirection(
        options.player.x - options.enemy.x,
        options.player.y - options.enemy.y,
        fallbackDirection(options.enemy.id, runtime),
      )
    : { x: runtime.facingX, y: runtime.facingY };
  const position = clampToWorld(
    options.enemy,
    options.enemyRadius,
    options.world,
  );
  return {
    ...position,
    runtime: { ...runtime, facingX: facing.x, facingY: facing.y },
  };
}

function chaseMovement(
  movement: Extract<EnemyMovement, { kind: "chase" }>,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  if (
    movement.requireLineOfSight &&
    !hasRectangularLineOfSight(options.enemy, options.player, options.world)
  ) {
    return stationary(options, runtime);
  }
  const currentDistance = distance(options.enemy, options.player);
  if (currentDistance <= movement.stopDistance) {
    return stationary(options, runtime);
  }
  const direction = unitDirection(
    options.player.x - options.enemy.x,
    options.player.y - options.enemy.y,
    fallbackDirection(options.enemy.id, runtime),
  );
  const distanceToMove = Math.min(
    options.baseSpeed * movement.speedMultiplier * deltaSeconds,
    currentDistance - movement.stopDistance,
  );
  return movedResult(direction, distanceToMove, runtime, options);
}

function fleeMovement(
  movement: Extract<EnemyMovement, { kind: "flee" }>,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  const currentDistance = distance(options.enemy, options.player);
  if (currentDistance >= movement.safeDistance) {
    return stationary(options, runtime);
  }
  const direction = unitDirection(
    options.enemy.x - options.player.x,
    options.enemy.y - options.player.y,
    fallbackDirection(options.enemy.id, runtime),
  );
  const distanceToMove = Math.min(
    options.baseSpeed * movement.speedMultiplier * deltaSeconds,
    movement.safeDistance - currentDistance,
  );
  return movedResult(direction, distanceToMove, runtime, options);
}

function orbitMovement(
  movement: Extract<EnemyMovement, { kind: "orbit" }>,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  const fallback = fallbackDirection(options.enemy.id, runtime);
  const radial = unitDirection(
    options.enemy.x - options.player.x,
    options.enemy.y - options.player.y,
    fallback,
  );
  const currentDistance = distance(options.enemy, options.player);
  const tangent = movement.clockwise
    ? { x: -radial.y, y: radial.x }
    : { x: radial.y, y: -radial.x };
  const radialCorrection =
    clamp(
      (movement.radius - currentDistance) / Math.max(1, movement.radius),
      -1,
      1,
    ) * movement.radialCorrection;
  const direction = unitDirection(
    tangent.x + radial.x * radialCorrection,
    tangent.y + radial.y * radialCorrection,
    tangent,
  );
  return movedResult(
    direction,
    options.baseSpeed * movement.speedMultiplier * deltaSeconds,
    runtime,
    options,
  );
}

function wanderMovement(
  movement: Extract<EnemyMovement, { kind: "wander" }>,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  let movementRuntime = runtime.movement;
  if (movementRuntime.kind !== "wander") {
    return stationary(options, runtime);
  }
  let rngState = runtime.rngState;
  if (
    runtime.stateElapsedSeconds + TIME_EPSILON_SECONDS >=
    movementRuntime.nextTurnAtSeconds
  ) {
    const heading = randomHeading(rngState);
    rngState = heading.rngState;
    movementRuntime = {
      kind: "wander",
      headingX: heading.x,
      headingY: heading.y,
      nextTurnAtSeconds:
        movementRuntime.nextTurnAtSeconds + movement.turnIntervalSeconds,
    };
  }
  const direction = {
    x: movementRuntime.headingX,
    y: movementRuntime.headingY,
  };
  const distanceToMove =
    options.baseSpeed * movement.speedMultiplier * deltaSeconds;
  const raw = {
    x: options.enemy.x + direction.x * distanceToMove,
    y: options.enemy.y + direction.y * distanceToMove,
  };
  const leashed = clampToCircle(
    raw,
    { x: runtime.spawnX, y: runtime.spawnY },
    movement.leashRadius,
  );
  const position = clampToWorld(leashed, options.enemyRadius, options.world);
  return {
    ...position,
    runtime: {
      ...runtime,
      facingX: direction.x,
      facingY: direction.y,
      rngState,
      movement: movementRuntime,
    },
  };
}

function patrolMovement(
  movement: Extract<EnemyMovement, { kind: "patrol" }>,
  runtime: EnemyBehaviorRuntimeState,
  options: StepEnemyBehaviorMovementOptions,
  deltaSeconds: number,
): EnemyBehaviorMovementResult {
  const movementRuntime = runtime.movement;
  if (movementRuntime.kind !== "patrol") {
    return stationary(options, runtime);
  }
  if (movementRuntime.pauseRemainingSeconds > 0) {
    const position = clampToWorld(
      options.enemy,
      options.enemyRadius,
      options.world,
    );
    return {
      ...position,
      runtime: {
        ...runtime,
        movement: {
          ...movementRuntime,
          pauseRemainingSeconds: Math.max(
            0,
            movementRuntime.pauseRemainingSeconds - deltaSeconds,
          ),
        },
      },
    };
  }
  if (movementRuntime.completed) {
    return stationary(options, runtime);
  }

  const waypointIndex = clamp(
    movementRuntime.waypointIndex,
    0,
    movement.waypoints.length - 1,
  );
  const waypoint = movement.waypoints[waypointIndex];
  if (waypoint === undefined) {
    return stationary(options, runtime);
  }
  const target = clampToWorld(
    {
      x: runtime.spawnX + waypoint.offsetX,
      y: runtime.spawnY + waypoint.offsetY,
    },
    options.enemyRadius,
    options.world,
  );
  const targetDistance = distance(options.enemy, target);
  const distanceToMove =
    options.baseSpeed * movement.speedMultiplier * deltaSeconds;

  if (targetDistance <= distanceToMove + TIME_EPSILON_SECONDS) {
    const isLast = waypointIndex === movement.waypoints.length - 1;
    return {
      ...target,
      runtime: {
        ...runtime,
        movement: {
          kind: "patrol",
          waypointIndex: isLast
            ? movement.loop
              ? 0
              : waypointIndex
            : waypointIndex + 1,
          pauseRemainingSeconds: waypoint.pauseSeconds,
          completed: isLast && !movement.loop,
        },
      },
    };
  }

  const direction = unitDirection(
    target.x - options.enemy.x,
    target.y - options.enemy.y,
    fallbackDirection(options.enemy.id, runtime),
  );
  return movedResult(direction, distanceToMove, runtime, options);
}

function movedResult(
  direction: { readonly x: number; readonly y: number },
  distanceToMove: number,
  runtime: EnemyBehaviorRuntimeState,
  options: Pick<
    StepEnemyBehaviorMovementOptions,
    "enemy" | "enemyRadius" | "world"
  >,
): EnemyBehaviorMovementResult {
  const position = clampToWorld(
    {
      x: options.enemy.x + direction.x * distanceToMove,
      y: options.enemy.y + direction.y * distanceToMove,
    },
    options.enemyRadius,
    options.world,
  );
  return {
    ...position,
    runtime: {
      ...runtime,
      facingX: direction.x,
      facingY: direction.y,
    },
  };
}

function stationary(
  options: Pick<
    StepEnemyBehaviorMovementOptions,
    "enemy" | "enemyRadius" | "world"
  >,
  runtime: EnemyBehaviorRuntimeState,
): EnemyBehaviorMovementResult {
  return {
    ...clampToWorld(options.enemy, options.enemyRadius, options.world),
    runtime,
  };
}

function fallbackDirection(
  enemyId: number,
  runtime: EnemyBehaviorRuntimeState,
): { readonly x: number; readonly y: number } {
  if (runtime.facingX !== 0 || runtime.facingY !== 0) {
    return unitDirection(runtime.facingX, runtime.facingY, { x: 1, y: 0 });
  }
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const;
  return directions[Math.abs(Math.trunc(enemyId)) % directions.length] ?? directions[0];
}

function randomHeading(rngState: number): {
  readonly x: number;
  readonly y: number;
  readonly rngState: number;
} {
  const roll = nextRandom(rngState);
  const angle = roll.value * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle), rngState: roll.state };
}

function stateById(behavior: EnemyBehaviorV1, stateId: string): BehaviorState {
  const state = behavior.states.find((candidate) => candidate.stateId === stateId);
  if (state === undefined) {
    throw new Error(`Estado de comportamento inexistente: ${stateId}`);
  }
  return state;
}

function compare(
  left: number,
  operator: "lt" | "lte" | "gt" | "gte",
  right: number,
): boolean {
  switch (operator) {
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
  }
}

function pointIsFinite(point: { readonly x: number; readonly y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointInside(
  point: { readonly x: number; readonly y: number },
  minimum: number,
  maximumX: number,
  maximumY: number,
): boolean {
  return (
    point.x >= minimum &&
    point.x <= maximumX &&
    point.y >= minimum &&
    point.y <= maximumY
  );
}

function clampToWorld(
  point: { readonly x: number; readonly y: number },
  radius: number,
  world: EnemyBehaviorWorld,
): { readonly x: number; readonly y: number } {
  const margin = world.wallThickness + radius;
  return {
    x: clamp(point.x, margin, world.width - margin),
    y: clamp(point.y, margin, world.height - margin),
  };
}

function clampToCircle(
  point: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  radius: number,
): { readonly x: number; readonly y: number } {
  const offsetX = point.x - center.x;
  const offsetY = point.y - center.y;
  const currentDistance = Math.hypot(offsetX, offsetY);
  if (currentDistance <= radius || currentDistance === 0) return point;
  const scale = radius / currentDistance;
  return {
    x: center.x + offsetX * scale,
    y: center.y + offsetY * scale,
  };
}

function unitDirection(
  x: number,
  y: number,
  fallback: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length === 0) return fallback;
  return { x: x / length, y: y / length };
}

function distance(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
