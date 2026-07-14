import type { EnemyBehaviorV1 } from "@collaborative-roguelike/studio-contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_PROJECT, type GameProject } from "./project";
import {
  EMPTY_INPUT,
  createSimulation,
  stepSimulation,
  type SimulationInput,
  type SimulationState,
} from "./simulation";

describe("simulação", () => {
  it("é determinística para projeto, seed e entradas iguais", () => {
    const input: SimulationInput = {
      moveX: 1,
      moveY: -0.4,
      shootX: 0,
      shootY: -1,
    };
    let first = createSimulation(DEFAULT_GAME_PROJECT);
    let second = createSimulation(DEFAULT_GAME_PROJECT);

    for (let tick = 0; tick < 90; tick += 1) {
      first = stepSimulation(first, input, 1 / 60, DEFAULT_GAME_PROJECT);
      second = stepSimulation(second, input, 1 / 60, DEFAULT_GAME_PROJECT);
    }

    expect(first).toEqual(second);
  });

  it("preserva exatamente o chase e o shape legados sem behavior", () => {
    const project: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      enemy: { ...DEFAULT_GAME_PROJECT.enemy, spawnCount: 1 },
    };
    const initial = createSimulation(project);
    const enemy = initial.enemies[0]!;
    const xDistance = initial.player.x - enemy.x;
    const yDistance = initial.player.y - enemy.y;
    const length = Math.hypot(xDistance, yDistance);
    const stepped = stepSimulation(initial, EMPTY_INPUT, 1 / 60, project);

    expect("behaviorRuntime" in enemy).toBe(false);
    expect(stepped.enemies[0]).toEqual({
      ...enemy,
      x: enemy.x + (xDistance / length) * project.enemy.speed * (1 / 60),
      y: enemy.y + (yDistance / length) * project.enemy.speed * (1 / 60),
    });
    expect("behaviorRuntime" in stepped.enemies[0]!).toBe(false);
    expect(stepped.rngState).toBe(initial.rngState);
  });

  it("torna behavior observável sem alterar o RNG global da simulação", () => {
    const legacy: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      enemy: { ...DEFAULT_GAME_PROJECT.enemy, spawnCount: 1 },
    };
    const idle = withBehavior({
      schemaVersion: 1,
      kind: "enemy-behavior",
      entryStateId: "idle",
      states: [
        {
          stateId: "idle",
          movement: { kind: "idle", facePlayer: true },
          transitions: [],
        },
      ],
    });
    const legacyInitial = createSimulation(legacy, { seed: "observable" });
    const idleInitial = createSimulation(idle, { seed: "observable" });
    const legacyNext = stepSimulation(legacyInitial, EMPTY_INPUT, 0.05, legacy);
    const idleNext = stepSimulation(idleInitial, EMPTY_INPUT, 0.05, idle);

    expect(idleInitial.enemies[0]?.x).toBe(legacyInitial.enemies[0]?.x);
    expect(idleNext.enemies[0]?.x).toBe(idleInitial.enemies[0]?.x);
    expect(idleNext.enemies[0]?.y).toBe(idleInitial.enemies[0]?.y);
    expect(legacyNext.enemies[0]).not.toMatchObject({
      x: idleNext.enemies[0]?.x,
      y: idleNext.enemies[0]?.y,
    });
    expect(idleNext.rngState).toBe(legacyNext.rngState);
  });

  it("mantém behavior determinístico inclusive após round-trip JSON", () => {
    const project = withBehavior({
      schemaVersion: 1,
      kind: "enemy-behavior",
      entryStateId: "wander",
      states: [
        {
          stateId: "wander",
          movement: {
            kind: "wander",
            speedMultiplier: 1,
            turnIntervalSeconds: 0.15,
            leashRadius: 80,
          },
          transitions: [
            {
              transitionId: "transition-random-chase",
              toStateId: "chase",
              when: {
                mode: "all",
                conditions: [
                  {
                    kind: "random-chance",
                    probability: 0.35,
                    intervalSeconds: 0.2,
                  },
                ],
              },
            },
          ],
        },
        {
          stateId: "chase",
          movement: {
            kind: "chase",
            speedMultiplier: 0.8,
            stopDistance: 40,
            requireLineOfSight: true,
          },
          transitions: [],
        },
      ],
    });
    let first = createSimulation(project, { seed: "behavior-determinism" });
    let second = createSimulation(project, { seed: "behavior-determinism" });

    for (let tick = 0; tick < 90; tick += 1) {
      first = stepSimulation(first, EMPTY_INPUT, 1 / 60, project);
      second = stepSimulation(second, EMPTY_INPUT, 1 / 60, project);
    }
    expect(first).toEqual(second);

    let restored = JSON.parse(JSON.stringify(second)) as SimulationState;
    for (let tick = 0; tick < 90; tick += 1) {
      first = stepSimulation(first, EMPTY_INPUT, 1 / 60, project);
      restored = stepSimulation(restored, EMPTY_INPUT, 1 / 60, project);
    }
    expect(restored).toEqual(first);
  });

  it("transiciona por was-hit no tick do impacto e move no estado novo depois", () => {
    const project = withBehavior({
      schemaVersion: 1,
      kind: "enemy-behavior",
      entryStateId: "waiting",
      states: [
        {
          stateId: "waiting",
          movement: { kind: "idle", facePlayer: true },
          transitions: [
            {
              transitionId: "transition-after-hit",
              toStateId: "flee",
              when: {
                mode: "all",
                conditions: [{ kind: "was-hit", withinSeconds: 0.2 }],
              },
            },
          ],
        },
        {
          stateId: "flee",
          movement: {
            kind: "flee",
            speedMultiplier: 1,
            safeDistance: 200,
          },
          transitions: [],
        },
      ],
    });
    const initial = createSimulation(project, {
      seed: "hit-transition",
      spawnCount: 1,
      enemyMaxHealth: 2,
    });
    const enemy = {
      ...initial.enemies[0]!,
      x: initial.player.x + 80,
      y: initial.player.y,
    };
    const impactState: SimulationState = {
      ...initial,
      nextEntityId: 100,
      enemies: [enemy],
      projectiles: [
        {
          id: 99,
          x: enemy.x,
          y: enemy.y,
          velocityX: 0,
          velocityY: 0,
          ageSeconds: 0,
        },
      ],
    };

    const afterImpact = stepSimulation(
      impactState,
      EMPTY_INPUT,
      1 / 60,
      project,
    );
    expect(afterImpact.enemies[0]).toMatchObject({
      x: enemy.x,
      y: enemy.y,
      health: 1,
      behaviorRuntime: { stateId: "flee", stateElapsedSeconds: 0 },
    });

    const afterFlee = stepSimulation(
      afterImpact,
      EMPTY_INPUT,
      1 / 60,
      project,
    );
    expect(afterFlee.enemies[0]!.x).toBeGreaterThan(enemy.x);
  });

  it("registra uma morte, um drop e limpa a sala exatamente uma vez", () => {
    const project: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      enemy: {
        ...DEFAULT_GAME_PROJECT.enemy,
        maxHealth: 1,
        speed: 10,
        spawnCount: 1,
        dropChance: 1,
      },
    };
    const initial = createSimulation(project);
    let state: SimulationState = {
      ...initial,
      enemies: [
        {
          id: initial.enemies[0]?.id ?? 1,
          health: 1,
          x: initial.player.x + 120,
          y: initial.player.y,
        },
      ],
    };
    const shootRight: SimulationInput = {
      ...EMPTY_INPUT,
      shootX: 1,
    };

    state = stepSimulation(state, shootRight, 1 / 60, project);
    while (state.status === "playing" && state.tick < 120) {
      state = stepSimulation(state, EMPTY_INPUT, 1 / 60, project);
    }

    expect(state.status).toBe("cleared");
    expect(state.enemiesDefeated).toBe(1);
    expect(state.pickups).toHaveLength(1);
    expect(state.events.filter((event) => event.type === "room-cleared")).toHaveLength(1);

    const afterClear = stepSimulation(state, EMPTY_INPUT, 1 / 60, project);
    expect(afterClear.enemiesDefeated).toBe(1);
    expect(afterClear.pickups).toHaveLength(1);
    expect(afterClear.events).toEqual([]);
  });

  it("permite andar e coletar o drop do último inimigo após limpar a sala", () => {
    const project: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      enemy: {
        ...DEFAULT_GAME_PROJECT.enemy,
        maxHealth: 1,
        speed: 10,
        spawnCount: 1,
        dropChance: 1,
      },
    };
    const initial = createSimulation(project);
    let state: SimulationState = {
      ...initial,
      player: { ...initial.player, health: project.player.maxHealth - 1 },
      enemies: [
        {
          id: initial.enemies[0]?.id ?? 1,
          health: 1,
          x: initial.player.x + 120,
          y: initial.player.y,
        },
      ],
    };

    state = stepSimulation(
      state,
      { ...EMPTY_INPUT, shootX: 1 },
      1 / 60,
      project,
    );
    while (state.status === "playing" && state.tick < 120) {
      state = stepSimulation(state, EMPTY_INPUT, 1 / 60, project);
    }

    expect(state.status).toBe("cleared");
    expect(state.pickups).toHaveLength(1);
    const clearedAtX = state.player.x;
    const shotsAtClear = state.shotsFired;
    const postClearEvents: string[] = [];
    for (let tick = 0; state.pickups.length > 0 && tick < 120; tick += 1) {
      state = stepSimulation(
        state,
        { ...EMPTY_INPUT, moveX: 1, shootX: 1 },
        1 / 60,
        project,
      );
      postClearEvents.push(...state.events.map((event) => event.type));
    }

    expect(state.status).toBe("cleared");
    expect(state.player.x).toBeGreaterThan(clearedAtX);
    expect(state.player.health).toBe(project.player.maxHealth);
    expect(state.pickups).toHaveLength(0);
    expect(state.shotsFired).toBe(shotsAtClear);
    expect(postClearEvents.filter((type) => type === "pickup-collected")).toHaveLength(1);
    expect(postClearEvents).not.toContain("shot");
    expect(postClearEvents).not.toContain("room-cleared");
  });

  it("preserva corações excedentes quando só falta um ponto de vida", () => {
    const project = DEFAULT_GAME_PROJECT;
    const initial = createSimulation(project, {
      spawnCount: 0,
      playerHealth: project.player.maxHealth - 1,
    });
    const state = stepSimulation(
      {
        ...initial,
        pickups: [
          { id: 10, kind: "heart", x: initial.player.x, y: initial.player.y },
          { id: 11, kind: "heart", x: initial.player.x, y: initial.player.y },
        ],
      },
      EMPTY_INPUT,
      1 / 60,
      project,
    );

    expect(state.player.health).toBe(project.player.maxHealth);
    expect(state.pickups).toHaveLength(1);
    expect(
      state.events.filter((event) => event.type === "pickup-collected"),
    ).toHaveLength(1);
  });

  it("remove projéteis antigos ou fora da sala", () => {
    const project: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      enemy: { ...DEFAULT_GAME_PROJECT.enemy, speed: 10, spawnCount: 1 },
    };
    let state = createSimulation(project);
    state = {
      ...state,
      enemies: [{ ...state.enemies[0]!, x: 100, y: 100 }],
    };
    state = stepSimulation(state, { ...EMPTY_INPUT, shootX: 1 }, 1 / 60, project);

    for (let tick = 0; tick < 120; tick += 1) {
      state = stepSimulation(state, EMPTY_INPUT, 1 / 60, project);
    }

    expect(state.projectiles).toHaveLength(0);
  });
});

function withBehavior(behavior: EnemyBehaviorV1): GameProject {
  return {
    ...DEFAULT_GAME_PROJECT,
    enemy: {
      ...DEFAULT_GAME_PROJECT.enemy,
      spawnCount: 1,
      behavior,
    },
  };
}
