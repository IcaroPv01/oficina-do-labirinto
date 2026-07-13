import { createSeededRng } from "./rng";

export type RoomKind = "start" | "combat" | "treasure" | "shop" | "boss";

export interface DungeonRoom {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: RoomKind;
  readonly connections: readonly string[];
}

export interface DungeonLayout {
  readonly seed: string;
  readonly rooms: readonly DungeonRoom[];
  readonly startRoomId: string;
  readonly bossRoomId: string;
}

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

export function generateDungeon(seed: string, requestedRooms = 9): DungeonLayout {
  const roomCount = Math.min(24, Math.max(5, Math.trunc(requestedRooms)));
  const random = createSeededRng(seed);
  const coordinates: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  const occupied = new Set([coordinateKey(0, 0)]);

  while (coordinates.length < roomCount) {
    const origin = coordinates[Math.floor(random() * coordinates.length)];
    if (!origin) {
      break;
    }

    const direction = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
    if (!direction) {
      continue;
    }

    const candidate = {
      x: origin.x + direction.x,
      y: origin.y + direction.y,
    };
    const key = coordinateKey(candidate.x, candidate.y);

    if (!occupied.has(key)) {
      occupied.add(key);
      coordinates.push(candidate);
    }
  }

  const farthestIndex = coordinates.reduce((bestIndex, room, index) => {
    const best = coordinates[bestIndex];
    if (!best) {
      return index;
    }
    return manhattan(room) > manhattan(best) ? index : bestIndex;
  }, 0);
  const eligibleSpecials = coordinates
    .map((_, index) => index)
    .filter((index) => index !== 0 && index !== farthestIndex);
  const shopIndex = eligibleSpecials[Math.floor(random() * eligibleSpecials.length)];
  const treasureOptions = eligibleSpecials.filter((index) => index !== shopIndex);
  const treasureIndex = treasureOptions[Math.floor(random() * treasureOptions.length)];

  const ids = coordinates.map((room) => `room-${room.x}-${room.y}`);
  const rooms = coordinates.map((room, index): DungeonRoom => {
    const kind: RoomKind =
      index === 0
        ? "start"
        : index === farthestIndex
          ? "boss"
          : index === shopIndex
            ? "shop"
            : index === treasureIndex
              ? "treasure"
              : "combat";
    const connections = DIRECTIONS.map((direction) =>
      coordinateKey(room.x + direction.x, room.y + direction.y),
    )
      .map((key) => coordinates.findIndex((candidate) => coordinateKey(candidate.x, candidate.y) === key))
      .filter((candidateIndex) => candidateIndex >= 0)
      .map((candidateIndex) => ids[candidateIndex])
      .filter((id): id is string => id !== undefined)
      .sort();

    return {
      id: ids[index] ?? `room-${index}`,
      x: room.x,
      y: room.y,
      kind,
      connections,
    };
  });

  return {
    seed,
    rooms,
    startRoomId: rooms[0]?.id ?? "room-0-0",
    bossRoomId: rooms[farthestIndex]?.id ?? rooms[0]?.id ?? "room-0-0",
  };
}

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function manhattan(room: { readonly x: number; readonly y: number }): number {
  return Math.abs(room.x) + Math.abs(room.y);
}

