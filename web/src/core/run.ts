import {
  generateDungeon,
  type DungeonLayout,
  type DungeonRoom,
  type RoomKind,
} from "./dungeon";
import type { GameProject } from "./project";
import {
  EMPTY_INPUT,
  createSimulation,
  stepSimulation,
  type SimulationEvent,
  type SimulationInput,
  type SimulationState,
} from "./simulation";

export type RunStatus = "playing" | "completed" | "game-over";
export type RunDirection = "north" | "south" | "east" | "west";
export type RunAction = "buy-heart" | "descend";
export type TransitionBlockedReason =
  | "room-not-cleared"
  | "no-room"
  | "key-required";
export type PurchaseFailedReason =
  | "not-in-shop"
  | "insufficient-coins"
  | "health-full";
export type DescendBlockedReason = "not-in-boss-room" | "boss-not-cleared";

export interface RunInput extends SimulationInput {
  readonly transition?: RunDirection;
  readonly action?: RunAction;
}

export interface CreateRunOptions {
  readonly seed?: string;
  readonly floor?: number;
  readonly health?: number;
  readonly coins?: number;
  readonly keys?: number;
}

export interface RunRoomState {
  readonly roomId: string;
  readonly kind: RoomKind;
  readonly visited: boolean;
  readonly cleared: boolean;
  readonly rewardGranted: boolean;
  readonly simulation: SimulationState;
}

export interface RoomReward {
  readonly coins: number;
  readonly keys: number;
  readonly health: number;
}

export type RunEvent =
  | {
      readonly type: "simulation-event";
      readonly roomId: string;
      readonly event: SimulationEvent;
    }
  | {
      readonly type: "room-entered";
      readonly roomId: string;
      readonly roomKind: RoomKind;
      readonly direction: RunDirection;
      readonly firstVisit: boolean;
    }
  | {
      readonly type: "room-transition-blocked";
      readonly roomId: string;
      readonly direction: RunDirection;
      readonly reason: TransitionBlockedReason;
    }
  | {
      readonly type: "key-spent";
      readonly roomId: string;
      readonly keys: number;
    }
  | {
      readonly type: "room-reward";
      readonly roomId: string;
      readonly roomKind: RoomKind;
      readonly reward: RoomReward;
      readonly health: number;
      readonly coins: number;
      readonly keys: number;
    }
  | {
      readonly type: "purchase-succeeded";
      readonly item: "heart";
      readonly cost: number;
      readonly health: number;
      readonly coins: number;
    }
  | {
      readonly type: "purchase-failed";
      readonly item: "heart";
      readonly reason: PurchaseFailedReason;
      readonly cost: number;
      readonly health: number;
      readonly coins: number;
    }
  | {
      readonly type: "descend-blocked";
      readonly reason: DescendBlockedReason;
    }
  | {
      readonly type: "floor-advanced";
      readonly fromFloor: number;
      readonly toFloor: number;
      readonly roomId: string;
    }
  | {
      readonly type: "run-won";
      readonly floor: number;
    }
  | {
      readonly type: "run-lost";
      readonly floor: number;
    };

export interface RunState {
  /** Base seed shared by every floor; each floor and room derives a stable seed. */
  readonly seed: string;
  readonly floor: number;
  readonly status: RunStatus;
  readonly dungeon: DungeonLayout;
  readonly currentRoomId: string;
  readonly rooms: readonly RunRoomState[];
  readonly health: number;
  readonly coins: number;
  readonly keys: number;
  readonly elapsedSeconds: number;
  readonly tick: number;
  readonly events: readonly RunEvent[];
}

export const EMPTY_RUN_INPUT: RunInput = { ...EMPTY_INPUT };

const DIRECTION_OFFSETS: Readonly<
  Record<RunDirection, { readonly x: number; readonly y: number }>
> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

export function createRun(
  project: GameProject,
  options: CreateRunOptions = {},
): RunState {
  const seed = options.seed?.trim() || project.seed;
  const floor = Math.max(1, Math.trunc(options.floor ?? 1));
  const health = clampInteger(
    options.health ?? project.player.maxHealth,
    1,
    project.player.maxHealth,
  );
  const coins = clampInteger(options.coins ?? project.run.startingCoins, 0, 999);
  const keys = clampInteger(options.keys ?? project.run.startingKeys, 0, 99);

  return createFloor(project, {
    seed,
    floor,
    health,
    coins,
    keys,
    elapsedSeconds: 0,
    tick: 0,
    events: [],
  });
}

export function stepRun(
  previous: RunState,
  input: RunInput,
  requestedDeltaSeconds: number,
  project: GameProject,
): RunState {
  if (previous.status !== "playing") {
    return clearTransientEvents(previous);
  }

  const deltaSeconds = clamp(requestedDeltaSeconds, 0, 0.05);
  let state: RunState = {
    ...previous,
    elapsedSeconds: previous.elapsedSeconds + deltaSeconds,
    tick: previous.tick + 1,
    events: [],
  };
  const current = getCurrentRunRoom(state);
  const steppedSimulation = stepSimulation(
    current.simulation,
    input,
    deltaSeconds,
    project,
  );
  state = replaceRoom(state, {
    ...current,
    cleared: current.cleared || steppedSimulation.status === "cleared",
    simulation: steppedSimulation,
  });
  state = {
    ...state,
    health: steppedSimulation.player.health,
    events: steppedSimulation.events.map(
      (event): RunEvent => ({
        type: "simulation-event",
        roomId: current.roomId,
        event,
      }),
    ),
  };

  if (steppedSimulation.status === "game-over") {
    return {
      ...state,
      status: "game-over",
      events: [...state.events, { type: "run-lost", floor: state.floor }],
    };
  }

  const roomAfterStep = getCurrentRunRoom(state);
  if (
    roomAfterStep.cleared &&
    !roomAfterStep.rewardGranted &&
    (roomAfterStep.kind === "combat" || roomAfterStep.kind === "boss")
  ) {
    state = grantRoomReward(state, roomAfterStep.roomId, project);
  }

  if (input.action === "buy-heart") {
    return buyHeart(state, project);
  } else if (input.action === "descend") {
    return descend(state, project);
  }

  if (state.status === "playing" && input.transition) {
    state = transitionRoom(state, input.transition, project);
  }

  return state;
}

export function getCurrentRunRoom(state: RunState): RunRoomState {
  const room = state.rooms.find((candidate) => candidate.roomId === state.currentRoomId);
  if (!room) {
    throw new Error(`Sala atual inexistente: ${state.currentRoomId}`);
  }
  return room;
}

export function getCurrentRunSimulation(state: RunState): SimulationState {
  return getCurrentRunRoom(state).simulation;
}

function createFloor(
  project: GameProject,
  base: {
    readonly seed: string;
    readonly floor: number;
    readonly health: number;
    readonly coins: number;
    readonly keys: number;
    readonly elapsedSeconds: number;
    readonly tick: number;
    readonly events: readonly RunEvent[];
  },
): RunState {
  const floorSeed = `${base.seed}:floor:${base.floor}`;
  const dungeon = generateDungeon(floorSeed, project.run.roomsPerFloor);
  const rooms = dungeon.rooms.map((room): RunRoomState => {
    const encounter = encounterForRoom(room.kind, base.floor, project);
    const simulation = createSimulation(project, {
      seed: `${floorSeed}:${room.id}:${room.kind}`,
      spawnCount: encounter.spawnCount,
      enemyMaxHealth: encounter.enemyMaxHealth,
      playerHealth: base.health,
    });
    const isStart = room.id === dungeon.startRoomId;
    return {
      roomId: room.id,
      kind: room.kind,
      visited: isStart,
      cleared: simulation.status === "cleared",
      rewardGranted: room.kind === "start" || room.kind === "shop",
      simulation,
    };
  });

  return {
    seed: base.seed,
    floor: base.floor,
    status: "playing",
    dungeon,
    currentRoomId: dungeon.startRoomId,
    rooms,
    health: base.health,
    coins: base.coins,
    keys: base.keys,
    elapsedSeconds: base.elapsedSeconds,
    tick: base.tick,
    events: base.events,
  };
}

function encounterForRoom(
  kind: RoomKind,
  floor: number,
  project: GameProject,
): { readonly spawnCount: number; readonly enemyMaxHealth: number } {
  if (kind === "boss") {
    return {
      spawnCount: 1,
      enemyMaxHealth: project.enemy.maxHealth * (floor + 2),
    };
  }
  if (kind === "combat") {
    return {
      spawnCount: Math.min(20, project.enemy.spawnCount + floor - 1),
      enemyMaxHealth: project.enemy.maxHealth + Math.floor((floor - 1) / 2),
    };
  }
  return { spawnCount: 0, enemyMaxHealth: project.enemy.maxHealth };
}

function transitionRoom(
  state: RunState,
  direction: RunDirection,
  project: GameProject,
): RunState {
  const currentProgress = getCurrentRunRoom(state);
  if (!currentProgress.cleared) {
    return appendEvent(state, {
      type: "room-transition-blocked",
      roomId: currentProgress.roomId,
      direction,
      reason: "room-not-cleared",
    });
  }

  const currentRoom = dungeonRoomById(state.dungeon, currentProgress.roomId);
  const offset = DIRECTION_OFFSETS[direction];
  const targetRoom = state.dungeon.rooms.find(
    (candidate) =>
      candidate.x === currentRoom.x + offset.x &&
      candidate.y === currentRoom.y + offset.y &&
      currentRoom.connections.includes(candidate.id),
  );
  if (!targetRoom) {
    return appendEvent(state, {
      type: "room-transition-blocked",
      roomId: currentProgress.roomId,
      direction,
      reason: "no-room",
    });
  }

  const targetProgress = roomProgressById(state, targetRoom.id);
  const firstVisit = !targetProgress.visited;
  if (targetProgress.kind === "treasure" && firstVisit && state.keys < 1) {
    return appendEvent(state, {
      type: "room-transition-blocked",
      roomId: targetRoom.id,
      direction,
      reason: "key-required",
    });
  }

  let next = state;
  if (targetProgress.kind === "treasure" && firstVisit) {
    next = {
      ...next,
      keys: next.keys - 1,
      events: [
        ...next.events,
        { type: "key-spent", roomId: targetRoom.id, keys: next.keys - 1 },
      ],
    };
  }

  const enteredProgress = roomProgressById(next, targetRoom.id);
  next = replaceRoom(next, {
    ...enteredProgress,
    visited: true,
    simulation: prepareSimulationForEntry(
      enteredProgress.simulation,
      next.health,
      project,
    ),
  });
  next = {
    ...next,
    currentRoomId: targetRoom.id,
    events: [
      ...next.events,
      {
        type: "room-entered",
        roomId: targetRoom.id,
        roomKind: targetRoom.kind,
        direction,
        firstVisit,
      },
    ],
  };

  if (targetRoom.kind === "treasure" && firstVisit) {
    next = grantRoomReward(next, targetRoom.id, project);
  }
  return next;
}

function grantRoomReward(
  state: RunState,
  roomId: string,
  project: GameProject,
): RunState {
  const room = roomProgressById(state, roomId);
  if (room.rewardGranted) {
    return state;
  }

  const reward = rewardForRoom(room.kind, state.floor);
  const health = Math.min(project.player.maxHealth, state.health + reward.health);
  const coins = Math.min(999, state.coins + reward.coins);
  const keys = Math.min(99, state.keys + reward.keys);
  let next = replaceRoom(state, {
    ...room,
    rewardGranted: true,
    simulation: withSimulationHealth(room.simulation, health),
  });
  next = {
    ...next,
    health,
    coins,
    keys,
    events: [
      ...next.events,
      {
        type: "room-reward",
        roomId,
        roomKind: room.kind,
        reward,
        health,
        coins,
        keys,
      },
    ],
  };
  return next;
}

function rewardForRoom(kind: RoomKind, floor: number): RoomReward {
  switch (kind) {
    case "combat":
      return { coins: 1 + Math.floor((floor - 1) / 2), keys: 0, health: 0 };
    case "treasure":
      return { coins: 2 + floor, keys: 0, health: 1 };
    case "boss":
      return { coins: 2 + floor, keys: 1, health: 1 };
    case "start":
    case "shop":
      return { coins: 0, keys: 0, health: 0 };
  }
}

function buyHeart(state: RunState, project: GameProject): RunState {
  const room = getCurrentRunRoom(state);
  const cost = project.run.shopHeartCost;
  let reason: PurchaseFailedReason | null = null;
  if (room.kind !== "shop") {
    reason = "not-in-shop";
  } else if (state.health >= project.player.maxHealth) {
    reason = "health-full";
  } else if (state.coins < cost) {
    reason = "insufficient-coins";
  }

  if (reason) {
    return appendEvent(state, {
      type: "purchase-failed",
      item: "heart",
      reason,
      cost,
      health: state.health,
      coins: state.coins,
    });
  }

  const health = state.health + 1;
  const coins = state.coins - cost;
  const next = replaceRoom(state, {
    ...room,
    simulation: withSimulationHealth(room.simulation, health),
  });
  return {
    ...next,
    health,
    coins,
    events: [
      ...next.events,
      { type: "purchase-succeeded", item: "heart", cost, health, coins },
    ],
  };
}

function descend(state: RunState, project: GameProject): RunState {
  const room = getCurrentRunRoom(state);
  if (room.kind !== "boss") {
    return appendEvent(state, {
      type: "descend-blocked",
      reason: "not-in-boss-room",
    });
  }
  if (!room.cleared) {
    return appendEvent(state, {
      type: "descend-blocked",
      reason: "boss-not-cleared",
    });
  }

  if (!project.run.endless && state.floor >= project.run.floorLimit) {
    return {
      ...state,
      status: "completed",
      events: [...state.events, { type: "run-won", floor: state.floor }],
    };
  }

  const nextFloor = state.floor + 1;
  const event: RunEvent = {
    type: "floor-advanced",
    fromFloor: state.floor,
    toFloor: nextFloor,
    roomId: room.roomId,
  };
  return createFloor(project, {
    seed: state.seed,
    floor: nextFloor,
    health: state.health,
    coins: state.coins,
    keys: state.keys,
    elapsedSeconds: state.elapsedSeconds,
    tick: state.tick,
    events: [...state.events, event],
  });
}

function prepareSimulationForEntry(
  simulation: SimulationState,
  health: number,
  project: GameProject,
): SimulationState {
  const center = {
    x: project.world.width / 2,
    y: project.world.height / 2,
  };
  return {
    ...simulation,
    status: simulation.enemies.length > 0 ? "playing" : "cleared",
    player: {
      ...simulation.player,
      ...center,
      health,
      fireCooldownRemaining: 0,
      invulnerabilityRemaining: 0,
    },
    projectiles: [],
    events: [],
  };
}

function withSimulationHealth(
  simulation: SimulationState,
  health: number,
): SimulationState {
  return {
    ...simulation,
    player: { ...simulation.player, health },
  };
}

function replaceRoom(state: RunState, replacement: RunRoomState): RunState {
  return {
    ...state,
    rooms: state.rooms.map((room) =>
      room.roomId === replacement.roomId ? replacement : room,
    ),
  };
}

function roomProgressById(state: RunState, roomId: string): RunRoomState {
  const room = state.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) {
    throw new Error(`Progresso de sala inexistente: ${roomId}`);
  }
  return room;
}

function dungeonRoomById(dungeon: DungeonLayout, roomId: string): DungeonRoom {
  const room = dungeon.rooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    throw new Error(`Sala inexistente no mapa: ${roomId}`);
  }
  return room;
}

function appendEvent(state: RunState, event: RunEvent): RunState {
  return { ...state, events: [...state.events, event] };
}

function clearTransientEvents(state: RunState): RunState {
  const current = getCurrentRunRoom(state);
  return replaceRoom(
    { ...state, events: [] },
    { ...current, simulation: { ...current.simulation, events: [] } },
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
