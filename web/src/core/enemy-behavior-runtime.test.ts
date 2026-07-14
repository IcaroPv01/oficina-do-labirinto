import type {
  EnemyBehaviorV1,
  EnemyConditionGroup,
  EnemyMovement,
} from "@collaborative-roguelike/studio-contracts";
import { describe, expect, it } from "vitest";
import {
  createEnemyBehaviorRuntime,
  hasRectangularLineOfSight,
  markEnemyBehaviorHit,
  resolveEnemyBehaviorTransitions,
  stepEnemyBehaviorMovement,
  type EnemyBehaviorEntitySnapshot,
  type EnemyBehaviorRuntimeState,
} from "./enemy-behavior-runtime";

const WORLD = { width: 500, height: 400, wallThickness: 20 } as const;
const PLAYER = { x: 200, y: 100 } as const;
const BASE_ENEMY: EnemyBehaviorEntitySnapshot = {
  id: 1,
  x: 100,
  y: 100,
  health: 10,
};

describe("runtime declarativo de inimigos", () => {
  describe("movimentos", () => {
    it("mantém idle parado e registra facing somente quando solicitado", () => {
      const behavior = behaviorForMovement({ kind: "idle", facePlayer: true });
      const result = moveOnce(behavior);

      expect(result).toMatchObject({ x: 100, y: 100 });
      expect(result.runtime).toMatchObject({ facingX: 1, facingY: 0 });
    });

    it("executa chase sem ultrapassar stopDistance", () => {
      const behavior = behaviorForMovement({
        kind: "chase",
        speedMultiplier: 1,
        stopDistance: 98,
        requireLineOfSight: true,
      });
      const result = moveOnce(behavior);

      expect(result.x).toBeCloseTo(102);
      expect(result.y).toBe(100);
    });

    it("executa flee até safeDistance sem ultrapassá-la", () => {
      const behavior = behaviorForMovement({
        kind: "flee",
        speedMultiplier: 3,
        safeDistance: 110,
      });
      const result = moveOnce(behavior);

      expect(result.x).toBeCloseTo(90);
      expect(Math.hypot(result.x - PLAYER.x, result.y - PLAYER.y)).toBeCloseTo(
        110,
      );
    });

    it("orbita no sentido horário das coordenadas de tela", () => {
      const behavior = behaviorForMovement({
        kind: "orbit",
        speedMultiplier: 1,
        radius: 50,
        clockwise: true,
        radialCorrection: 0,
      });
      const enemy = { ...BASE_ENEMY, x: 250, y: 100 };
      const result = moveOnce(behavior, enemy);

      expect(result.x).toBeCloseTo(250);
      expect(result.y).toBeCloseTo(105);
    });

    it("faz wander determinístico, troca heading no intervalo e respeita leash", () => {
      const behavior = behaviorForMovement({
        kind: "wander",
        speedMultiplier: 1,
        turnIntervalSeconds: 0.1,
        leashRadius: 16,
      });
      const initial = runtimeFor(behavior);
      const first = moveWithRuntime(behavior, BASE_ENEMY, initial, 0.05);
      const second = moveWithRuntime(
        behavior,
        { ...BASE_ENEMY, x: first.x, y: first.y },
        first.runtime,
        0.05,
      );

      expect(first.runtime.rngState).toBe(initial.rngState);
      expect(second.runtime.rngState).not.toBe(first.runtime.rngState);
      expect(
        Math.hypot(second.x - initial.spawnX, second.y - initial.spawnY),
      ).toBeLessThanOrEqual(16 + 1e-9);

      let repeatedEnemy = BASE_ENEMY;
      let repeatedRuntime = runtimeFor(behavior);
      for (let tick = 0; tick < 2; tick += 1) {
        const next = moveWithRuntime(
          behavior,
          repeatedEnemy,
          repeatedRuntime,
          0.05,
        );
        repeatedEnemy = { ...repeatedEnemy, x: next.x, y: next.y };
        repeatedRuntime = next.runtime;
      }
      expect({ enemy: repeatedEnemy, runtime: repeatedRuntime }).toEqual({
        enemy: { ...BASE_ENEMY, x: second.x, y: second.y },
        runtime: second.runtime,
      });
    });

    it("percorre patrol, respeita waypoints e termina sem loop", () => {
      const behavior = behaviorForMovement({
        kind: "patrol",
        speedMultiplier: 1,
        waypoints: [
          { offsetX: 10, offsetY: 0, pauseSeconds: 0 },
          { offsetX: 20, offsetY: 0, pauseSeconds: 0 },
        ],
        loop: false,
      });
      let enemy = BASE_ENEMY;
      let runtime = runtimeFor(behavior);

      for (let tick = 0; tick < 4; tick += 1) {
        const next = moveWithRuntime(behavior, enemy, runtime, 0.05);
        enemy = { ...enemy, x: next.x, y: next.y };
        runtime = next.runtime;
      }

      expect(enemy).toMatchObject({ x: 120, y: 100 });
      expect(runtime.movement).toMatchObject({
        kind: "patrol",
        waypointIndex: 1,
        completed: true,
      });
      const afterCompletion = moveWithRuntime(behavior, enemy, runtime, 0.05);
      expect(afterCompletion).toMatchObject({ x: 120, y: 100 });
    });
  });

  describe("transições", () => {
    it("aplica always depois do movimento atual e não encadeia estados", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [{ kind: "always" }],
      });
      const initial = runtimeFor(behavior);
      const moved = moveWithRuntime(behavior, BASE_ENEMY, initial, 0.05);
      const transitioned = resolve(behavior, moved.runtime, BASE_ENEMY, 0.05);

      expect(moved).toMatchObject({ x: 100, y: 100 });
      expect(transitioned).toMatchObject({
        stateId: "active",
        stateElapsedSeconds: 0,
      });

      const next = moveWithRuntime(behavior, BASE_ENEMY, transitioned, 0.05);
      expect(next.x).toBeGreaterThan(100);
    });

    it("avalia distance-to-player com distância euclidiana", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [
          { kind: "distance-to-player", operator: "lte", pixels: 100 },
        ],
      });
      const runtime = runtimeFor(behavior);

      expect(resolve(behavior, runtime, BASE_ENEMY, 0).stateId).toBe("active");
    });

    it("calcula health-ratio com a vida máxima real do encontro", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [{ kind: "health-ratio", operator: "lt", ratio: 0.5 }],
      });
      const runtime = runtimeFor(behavior, { encounterMaxHealth: 20 });

      expect(
        resolve(behavior, runtime, { ...BASE_ENEMY, health: 9 }, 0).stateId,
      ).toBe("active");
      expect(
        resolve(behavior, runtime, { ...BASE_ENEMY, health: 10 }, 0).stateId,
      ).toBe("waiting");
    });

    it("torna state-elapsed verdadeiro no limite inclusivo", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [{ kind: "state-elapsed", seconds: 0.1 }],
      });
      let runtime = runtimeFor(behavior);
      let enemy = BASE_ENEMY;

      let moved = moveWithRuntime(behavior, enemy, runtime, 0.05);
      runtime = resolve(behavior, moved.runtime, enemy, 0.05);
      expect(runtime.stateId).toBe("waiting");
      enemy = { ...enemy, x: moved.x, y: moved.y };
      moved = moveWithRuntime(behavior, enemy, runtime, 0.05);
      runtime = resolve(behavior, moved.runtime, enemy, 0.1);
      expect(runtime.stateId).toBe("active");
    });

    it("define line-of-sight apenas pelo retângulo interno convexo", () => {
      expect(hasRectangularLineOfSight(BASE_ENEMY, PLAYER, WORLD)).toBe(true);
      expect(
        hasRectangularLineOfSight({ x: 10, y: 100 }, PLAYER, WORLD),
      ).toBe(false);

      const behavior = transitionBehavior({
        mode: "all",
        conditions: [{ kind: "line-of-sight", visible: true }],
      });
      expect(resolve(behavior, runtimeFor(behavior), BASE_ENEMY, 0).stateId).toBe(
        "active",
      );
    });

    it("observa was-hit no mesmo tick e preserva o hit entre estados", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [{ kind: "was-hit", withinSeconds: 0.1 }],
      });
      const hitRuntime = markEnemyBehaviorHit(runtimeFor(behavior), 1);

      expect(resolve(behavior, hitRuntime, BASE_ENEMY, 1).stateId).toBe(
        "active",
      );
      expect(resolve(behavior, hitRuntime, BASE_ENEMY, 1.11).stateId).toBe(
        "waiting",
      );
    });

    it("mantém random-chance estável durante o intervalo e atualiza RNG local", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [
          { kind: "distance-to-player", operator: "gt", pixels: 999 },
          {
            kind: "random-chance",
            probability: 0.5,
            intervalSeconds: 0.1,
          },
        ],
      });
      let runtime = runtimeFor(behavior);
      const initialCheck = runtime.randomChecks[0];
      const initialRng = runtime.rngState;

      runtime = {
        ...runtime,
        stateElapsedSeconds: 0.05,
      };
      runtime = resolve(behavior, runtime, BASE_ENEMY, 0.05);
      expect(runtime.rngState).toBe(initialRng);
      expect(runtime.randomChecks[0]).toEqual(initialCheck);

      runtime = { ...runtime, stateElapsedSeconds: 0.1 };
      runtime = resolve(behavior, runtime, BASE_ENEMY, 0.1);
      expect(runtime.rngState).not.toBe(initialRng);
      expect(runtime.randomChecks[0]?.nextRollAtSeconds).toBeCloseTo(0.2);
    });

    it("permite random-chance determinística com probabilidade um", () => {
      const behavior = transitionBehavior({
        mode: "all",
        conditions: [
          {
            kind: "random-chance",
            probability: 1,
            intervalSeconds: 0.1,
          },
        ],
      });
      const first = resolve(behavior, runtimeFor(behavior), BASE_ENEMY, 0);
      const second = resolve(behavior, runtimeFor(behavior), BASE_ENEMY, 0);

      expect(first).toEqual(second);
      expect(first.stateId).toBe("active");
    });
  });

  it("mantém o runtime serializável em JSON", () => {
    const behavior = behaviorForMovement({
      kind: "wander",
      speedMultiplier: 1,
      turnIntervalSeconds: 0.2,
      leashRadius: 40,
    });
    const runtime = runtimeFor(behavior);

    expect(JSON.parse(JSON.stringify(runtime))).toEqual(runtime);
  });
});

function behaviorForMovement(movement: EnemyMovement): EnemyBehaviorV1 {
  return {
    schemaVersion: 1,
    kind: "enemy-behavior",
    entryStateId: "active",
    states: [{ stateId: "active", movement, transitions: [] }],
  };
}

function transitionBehavior(condition: EnemyConditionGroup): EnemyBehaviorV1 {
  return {
    schemaVersion: 1,
    kind: "enemy-behavior",
    entryStateId: "waiting",
    states: [
      {
        stateId: "waiting",
        movement: { kind: "idle", facePlayer: false },
        transitions: [
          {
            transitionId: "transition-active",
            toStateId: "active",
            when: condition,
          },
        ],
      },
      {
        stateId: "active",
        movement: {
          kind: "chase",
          speedMultiplier: 1,
          stopDistance: 0,
          requireLineOfSight: false,
        },
        transitions: [],
      },
    ],
  };
}

function runtimeFor(
  behavior: EnemyBehaviorV1,
  overrides: Partial<{
    readonly simulationSeed: string;
    readonly encounterMaxHealth: number;
  }> = {},
): EnemyBehaviorRuntimeState {
  return createEnemyBehaviorRuntime(behavior, {
    simulationSeed: overrides.simulationSeed ?? "behavior-test",
    enemyId: BASE_ENEMY.id,
    x: BASE_ENEMY.x,
    y: BASE_ENEMY.y,
    encounterMaxHealth: overrides.encounterMaxHealth ?? BASE_ENEMY.health,
  });
}

function moveOnce(
  behavior: EnemyBehaviorV1,
  enemy: EnemyBehaviorEntitySnapshot = BASE_ENEMY,
) {
  return moveWithRuntime(behavior, enemy, runtimeFor(behavior), 0.05);
}

function moveWithRuntime(
  behavior: EnemyBehaviorV1,
  enemy: EnemyBehaviorEntitySnapshot,
  runtime: EnemyBehaviorRuntimeState,
  deltaSeconds: number,
) {
  return stepEnemyBehaviorMovement({
    behavior,
    runtime,
    enemy,
    player: PLAYER,
    baseSpeed: 100,
    enemyRadius: 10,
    deltaSeconds,
    world: WORLD,
  });
}

function resolve(
  behavior: EnemyBehaviorV1,
  runtime: EnemyBehaviorRuntimeState,
  enemy: EnemyBehaviorEntitySnapshot,
  nowSeconds: number,
): EnemyBehaviorRuntimeState {
  return resolveEnemyBehaviorTransitions({
    behavior,
    runtime,
    enemy,
    player: PLAYER,
    nowSeconds,
    world: WORLD,
  });
}
