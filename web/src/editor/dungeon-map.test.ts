import { describe, expect, it } from "vitest";
import type { DungeonLayout } from "../core";
import { calculateDungeonMapGeometry } from "./dungeon-map";

const layout: DungeonLayout = {
  seed: "mapa-teste",
  startRoomId: "start",
  bossRoomId: "boss",
  rooms: [
    {
      id: "start",
      x: -1,
      y: 2,
      kind: "start",
      connections: ["combat"],
    },
    {
      id: "combat",
      x: 0,
      y: 2,
      kind: "combat",
      connections: ["start", "boss", "desconhecida"],
    },
    {
      id: "boss",
      x: 0,
      y: 3,
      kind: "boss",
      connections: ["combat"],
    },
  ],
};

describe("calculateDungeonMapGeometry", () => {
  it("normaliza coordenadas negativas e preserva tipos", () => {
    const geometry = calculateDungeonMapGeometry(layout);

    expect(geometry.rooms).toEqual([
      { id: "start", kind: "start", x: 38, y: 38, size: 42 },
      { id: "combat", kind: "combat", x: 110, y: 38, size: 42 },
      { id: "boss", kind: "boss", x: 110, y: 110, size: 42 },
    ]);
    expect(geometry.width).toBe(148);
    expect(geometry.height).toBe(148);
  });

  it("deduplica conexões simétricas e ignora destinos ausentes", () => {
    const geometry = calculateDungeonMapGeometry(layout);

    expect(geometry.connections).toHaveLength(2);
    expect(geometry.connections.map(({ fromId, toId }) => [fromId, toId])).toEqual([
      ["combat", "start"],
      ["boss", "combat"],
    ]);
  });

  it("produz uma área mínima para uma dungeon vazia", () => {
    const geometry = calculateDungeonMapGeometry({
      seed: "vazia",
      rooms: [],
      startRoomId: "",
      bossRoomId: "",
    });

    expect(geometry).toMatchObject({ width: 120, height: 120, rooms: [] });
  });

  it("recusa IDs duplicados e coordenadas não finitas", () => {
    expect(() =>
      calculateDungeonMapGeometry({
        ...layout,
        rooms: [layout.rooms[0]!, layout.rooms[0]!],
      }),
    ).toThrow(/duplicado/);

    expect(() =>
      calculateDungeonMapGeometry({
        ...layout,
        rooms: [{ ...layout.rooms[0]!, x: Number.NaN }],
      }),
    ).toThrow(/coordenada/);
  });
});
