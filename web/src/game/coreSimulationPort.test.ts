import { describe, expect, it } from "vitest";

import { DEFAULT_GAME_PROJECT } from "../core";
import { CoreSimulationPort } from "./coreSimulationPort";
import type { PreviewInputState } from "./simulationPort";

const IDLE_INPUT: PreviewInputState = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  transition: null,
  action: null,
};

describe("CoreSimulationPort", () => {
  it("expõe o estado completo e determinístico da run", () => {
    const first = new CoreSimulationPort().reset(
      DEFAULT_GAME_PROJECT,
      DEFAULT_GAME_PROJECT.seed,
    ).model;
    const second = new CoreSimulationPort().reset(
      DEFAULT_GAME_PROJECT,
      DEFAULT_GAME_PROJECT.seed,
    ).model;

    expect(first.floor).toBe(1);
    expect(first.currentRoomId).toBe(first.dungeon.startRoomId);
    expect(first.roomKind).toBe("start");
    expect(first.roomCleared).toBe(true);
    expect(first.player.radius).toBeCloseTo(14);
    expect(first.visitedRoomIds).toEqual([first.currentRoomId]);
    expect(second.dungeon).toEqual(first.dungeon);
    expect(second.connections).toEqual(first.connections);
  });

  it("transiciona uma única vez quando recebe uma borda de direção", () => {
    const port = new CoreSimulationPort();
    const initial = port.reset(DEFAULT_GAME_PROJECT, DEFAULT_GAME_PROJECT.seed);
    const connection = initial.model.connections[0];
    expect(connection).toBeDefined();

    const entered = port.step(
      { ...IDLE_INPUT, transition: connection?.direction ?? null },
      1000 / 60,
    );
    expect(entered.model.currentRoomId).toBe(connection?.targetRoomId);
    expect(entered.model.visitedRoomIds).toContain(connection?.targetRoomId);

    const heldWithoutNewEdge = port.step(IDLE_INPUT, 1000 / 60);
    expect(heldWithoutNewEdge.model.currentRoomId).toBe(connection?.targetRoomId);
  });
});
