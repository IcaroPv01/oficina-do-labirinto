import { describe, expect, it } from "vitest";
import { generateDungeon } from "./dungeon";

describe("generateDungeon", () => {
  it("gera o mesmo mapa para a mesma seed", () => {
    expect(generateDungeon("amizade-2026", 12)).toEqual(
      generateDungeon("amizade-2026", 12),
    );
    expect(generateDungeon("amizade-2026", 12)).not.toEqual(
      generateDungeon("outra-seed", 12),
    );
  });

  it("gera conexões simétricas, início e chefe", () => {
    const dungeon = generateDungeon("mapa-validado", 10);
    const byId = new Map(dungeon.rooms.map((room) => [room.id, room]));

    expect(dungeon.rooms).toHaveLength(10);
    expect(byId.get(dungeon.startRoomId)?.kind).toBe("start");
    expect(byId.get(dungeon.bossRoomId)?.kind).toBe("boss");

    for (const room of dungeon.rooms) {
      for (const connection of room.connections) {
        expect(byId.get(connection)?.connections).toContain(room.id);
      }
    }
  });
});

