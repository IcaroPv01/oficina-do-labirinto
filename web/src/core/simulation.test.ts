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
