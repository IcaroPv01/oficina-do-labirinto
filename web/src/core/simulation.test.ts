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

