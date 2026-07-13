import { describe, expect, it } from "vitest";
import type { DungeonLayout } from "./dungeon";
import { DEFAULT_GAME_PROJECT, type GameProject } from "./project";
import {
  EMPTY_RUN_INPUT,
  createRun,
  getCurrentRunRoom,
  stepRun,
  type RunDirection,
  type RunState,
} from "./run";

describe("run procedural", () => {
  it("é determinística e contém todos os tipos de sala", () => {
    const first = createRun(DEFAULT_GAME_PROJECT);
    const second = createRun(DEFAULT_GAME_PROJECT);
    const other = createRun(DEFAULT_GAME_PROJECT, { seed: "outra-run" });

    expect(first).toEqual(second);
    expect(first.dungeon).not.toEqual(other.dungeon);
    expect(new Set(first.dungeon.rooms.map((room) => room.kind))).toEqual(
      new Set(["start", "combat", "treasure", "shop", "boss"]),
    );
    const boss = first.rooms.find((room) => room.kind === "boss");
    expect(boss?.simulation.enemies).toHaveLength(1);
    expect(boss?.simulation.enemies[0]?.health).toBe(
      DEFAULT_GAME_PROJECT.enemy.maxHealth * 3,
    );
  });

  it("bloqueia a saída durante combate e permite depois de limpar", () => {
    const project = withRunDefaults({ startingKeys: 9 });
    const initial = createRun(project);
    const combatId = initial.dungeon.rooms.find((room) => room.kind === "combat")?.id;
    expect(combatId).toBeDefined();
    const path = shortestPath(initial.dungeon, initial.currentRoomId, combatId!);
    let state = walkPath(initial, path, project);
    const previousId = path.at(-2);
    expect(previousId).toBeDefined();
    const back = directionBetween(state.dungeon, state.currentRoomId, previousId!);

    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: back }, 0, project);
    expect(state.currentRoomId).toBe(combatId);
    expect(state.events).toContainEqual(
      expect.objectContaining({
        type: "room-transition-blocked",
        reason: "room-not-cleared",
      }),
    );

    state = markRoomCleared(state, combatId!);
    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: back }, 0, project);
    expect(state.currentRoomId).toBe(previousId);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "room-entered", roomId: previousId }),
    );
  });

  it("cobra uma chave só na primeira entrada e entrega tesouro uma vez", () => {
    const project = withRunDefaults({ startingKeys: 0 });
    const initial = createRun(project);
    const treasureId = initial.dungeon.rooms.find((room) => room.kind === "treasure")?.id;
    expect(treasureId).toBeDefined();
    const path = shortestPath(initial.dungeon, initial.currentRoomId, treasureId!);
    const beforeTreasure = markRoomCleared(
      walkPath(initial, path.slice(0, -1), project),
      path.at(-2)!,
      true,
    );
    const previousId = beforeTreasure.currentRoomId;
    const enter = directionBetween(beforeTreasure.dungeon, previousId, treasureId!);

    let state = stepRun(
      beforeTreasure,
      { ...EMPTY_RUN_INPUT, transition: enter },
      0,
      project,
    );
    expect(state.currentRoomId).toBe(previousId);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "room-transition-blocked", reason: "key-required" }),
    );

    state = { ...state, keys: 1 };
    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: enter }, 0, project);
    expect(state.currentRoomId).toBe(treasureId);
    expect(state.keys).toBe(0);
    expect(state.coins).toBe(3);
    expect(state.events.filter((event) => event.type === "room-reward")).toHaveLength(1);

    const leave = directionBetween(state.dungeon, treasureId!, previousId);
    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: leave }, 0, project);
    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: enter }, 0, project);
    expect(state.keys).toBe(0);
    expect(state.coins).toBe(3);
    expect(state.events.filter((event) => event.type === "key-spent")).toHaveLength(0);
    expect(state.events.filter((event) => event.type === "room-reward")).toHaveLength(0);
  });

  it("registra drop e recompensa de combate exatamente uma vez", () => {
    const project: GameProject = {
      ...withRunDefaults({ startingKeys: 9 }),
      enemy: {
        ...DEFAULT_GAME_PROJECT.enemy,
        maxHealth: 1,
        speed: 10,
        spawnCount: 1,
        dropChance: 1,
      },
    };
    let state = createRun(project);
    const combatId = state.dungeon.rooms.find((room) => room.kind === "combat")?.id;
    expect(combatId).toBeDefined();
    state = walkPath(
      state,
      shortestPath(state.dungeon, state.currentRoomId, combatId!),
      project,
    );
    const current = getCurrentRunRoom(state);
    const enemyId = current.simulation.enemies[0]?.id ?? 1;
    state = replaceRoomForTest(state, {
      ...current,
      simulation: {
        ...current.simulation,
        enemies: [
          {
            id: enemyId,
            health: 1,
            x: current.simulation.player.x + 120,
            y: current.simulation.player.y,
          },
        ],
      },
    });

    const seenEvents: string[] = [];
    state = stepRun(state, { ...EMPTY_RUN_INPUT, shootX: 1 }, 1 / 60, project);
    seenEvents.push(...simulationEventTypes(state));
    for (let tick = 0; getCurrentRunRoom(state).simulation.status === "playing" && tick < 120; tick += 1) {
      state = stepRun(state, EMPTY_RUN_INPUT, 1 / 60, project);
      seenEvents.push(...simulationEventTypes(state));
    }

    expect(getCurrentRunRoom(state).cleared).toBe(true);
    expect(getCurrentRunRoom(state).rewardGranted).toBe(true);
    expect(getCurrentRunRoom(state).simulation.pickups).toHaveLength(1);
    expect(seenEvents.filter((type) => type === "drop-created")).toHaveLength(1);
    expect(state.coins).toBe(1);

    for (let tick = 0; tick < 10; tick += 1) {
      state = stepRun(state, EMPTY_RUN_INPUT, 1 / 60, project);
      expect(state.events).toEqual([]);
    }
    expect(state.coins).toBe(1);
    expect(getCurrentRunRoom(state).simulation.pickups).toHaveLength(1);
  });

  it("mantém vida e recursos e processa compra na loja", () => {
    const project = withRunDefaults({
      startingCoins: 3,
      startingKeys: 9,
      shopHeartCost: 3,
    });
    let state = createRun(project, { health: project.player.maxHealth - 1 });
    const shopId = state.dungeon.rooms.find((room) => room.kind === "shop")?.id;
    expect(shopId).toBeDefined();
    state = walkPath(
      state,
      shortestPath(state.dungeon, state.currentRoomId, shopId!),
      project,
    );
    expect(getCurrentRunRoom(state).simulation.player.health).toBe(
      project.player.maxHealth - 1,
    );

    state = stepRun(state, { ...EMPTY_RUN_INPUT, action: "buy-heart" }, 0, project);
    expect(state.health).toBe(project.player.maxHealth);
    expect(state.coins).toBe(0);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "purchase-succeeded", cost: 3 }),
    );

    state = stepRun(state, { ...EMPTY_RUN_INPUT, action: "buy-heart" }, 0, project);
    expect(state.health).toBe(project.player.maxHealth);
    expect(state.coins).toBe(0);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "purchase-failed", reason: "health-full" }),
    );
  });

  it("avança o andar, preserva o estado e conclui no limite", () => {
    const project = withRunDefaults({ floorLimit: 2, startingCoins: 2, startingKeys: 0 });
    let state = forceBossCleared(createRun(project, { health: 3 }));
    state = stepRun(state, { ...EMPTY_RUN_INPUT, action: "descend" }, 0, project);

    expect(state.floor).toBe(2);
    expect(state.health).toBe(3);
    expect(state.coins).toBe(2);
    expect(state.keys).toBe(0);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "floor-advanced", fromFloor: 1, toFloor: 2 }),
    );

    state = forceBossCleared(state);
    state = stepRun(state, { ...EMPTY_RUN_INPUT, action: "descend" }, 0, project);
    expect(state.status).toBe("completed");
    expect(state.events).toContainEqual({ type: "run-won", floor: 2 });

    state = stepRun(state, EMPTY_RUN_INPUT, 1 / 60, project);
    expect(state.events).toEqual([]);
    expect(state.status).toBe("completed");
  });

  it("faz uma ação consumir o tick antes de qualquer transição", () => {
    const project = withRunDefaults({ floorLimit: 3 });
    const nextFloor = createRun(project, { floor: 2 });
    const start = nextFloor.dungeon.rooms.find(
      (room) => room.id === nextFloor.currentRoomId,
    );
    const neighborId = start?.connections[0];
    expect(neighborId).toBeDefined();
    const direction = directionBetween(
      nextFloor.dungeon,
      nextFloor.currentRoomId,
      neighborId!,
    );

    const state = stepRun(
      forceBossCleared(createRun(project)),
      { ...EMPTY_RUN_INPUT, action: "descend", transition: direction },
      0,
      project,
    );

    expect(state.floor).toBe(2);
    expect(state.currentRoomId).toBe(state.dungeon.startRoomId);
    expect(state.events.some((event) => event.type === "room-entered")).toBe(false);
  });

  it("ignora o limite quando endless está ativo", () => {
    const project = withRunDefaults({ endless: true, floorLimit: 1 });
    const state = stepRun(
      forceBossCleared(createRun(project)),
      { ...EMPTY_RUN_INPUT, action: "descend" },
      0,
      project,
    );

    expect(state.status).toBe("playing");
    expect(state.floor).toBe(2);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: "floor-advanced", toFloor: 2 }),
    );
  });
});

function withRunDefaults(overrides: Partial<GameProject["run"]>): GameProject {
  return {
    ...DEFAULT_GAME_PROJECT,
    run: { ...DEFAULT_GAME_PROJECT.run, ...overrides },
  };
}

function shortestPath(
  dungeon: DungeonLayout,
  startId: string,
  targetId: string,
): readonly string[] {
  const queue: string[][] = [[startId]];
  const visited = new Set([startId]);
  while (queue.length > 0) {
    const path = queue.shift();
    const roomId = path?.at(-1);
    if (!path || !roomId) {
      continue;
    }
    if (roomId === targetId) {
      return path;
    }
    const room = dungeon.rooms.find((candidate) => candidate.id === roomId);
    for (const connection of room?.connections ?? []) {
      if (!visited.has(connection)) {
        visited.add(connection);
        queue.push([...path, connection]);
      }
    }
  }
  throw new Error(`Sem caminho entre ${startId} e ${targetId}`);
}

function walkPath(
  initial: RunState,
  path: readonly string[],
  project: GameProject,
): RunState {
  let state = initial;
  for (const targetId of path.slice(1)) {
    state = markRoomCleared(state, state.currentRoomId, true);
    const direction = directionBetween(state.dungeon, state.currentRoomId, targetId);
    state = stepRun(state, { ...EMPTY_RUN_INPUT, transition: direction }, 0, project);
  }
  return state;
}

function directionBetween(
  dungeon: DungeonLayout,
  fromId: string,
  toId: string,
): RunDirection {
  const from = dungeon.rooms.find((room) => room.id === fromId);
  const to = dungeon.rooms.find((room) => room.id === toId);
  if (!from || !to) {
    throw new Error("Sala ausente no teste.");
  }
  const x = to.x - from.x;
  const y = to.y - from.y;
  if (x === 1 && y === 0) return "east";
  if (x === -1 && y === 0) return "west";
  if (x === 0 && y === 1) return "south";
  if (x === 0 && y === -1) return "north";
  throw new Error("As salas do teste não são vizinhas.");
}

function markRoomCleared(
  state: RunState,
  roomId: string,
  rewardGranted = false,
): RunState {
  const room = state.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) {
    throw new Error("Sala ausente no teste.");
  }
  return replaceRoomForTest(state, {
    ...room,
    cleared: true,
    rewardGranted: rewardGranted || room.rewardGranted,
    simulation: {
      ...room.simulation,
      status: "cleared",
      enemies: [],
      projectiles: [],
      events: [],
    },
  });
}

function replaceRoomForTest(
  state: RunState,
  replacement: RunState["rooms"][number],
): RunState {
  return {
    ...state,
    rooms: state.rooms.map((room) =>
      room.roomId === replacement.roomId ? replacement : room,
    ),
  };
}

function forceBossCleared(state: RunState): RunState {
  const boss = state.rooms.find((room) => room.kind === "boss");
  if (!boss) {
    throw new Error("Chefe ausente no teste.");
  }
  return {
    ...markRoomCleared(state, boss.roomId, true),
    currentRoomId: boss.roomId,
  };
}

function simulationEventTypes(state: RunState): string[] {
  return state.events.flatMap((event) =>
    event.type === "simulation-event" ? [event.event.type] : [],
  );
}
