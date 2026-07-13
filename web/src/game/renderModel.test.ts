import { describe, expect, it } from "vitest";

import { hasCollectiblePickup } from "./renderModel";

describe("hasCollectiblePickup", () => {
  it("só bloqueia a saída quando um coração ainda pode recuperar vida", () => {
    const pickup = { id: "heart-1", x: 0, y: 0, kind: "heart" as const };
    const player = {
      id: "player",
      x: 0,
      y: 0,
      health: 5,
      maxHealth: 6,
      radius: 18,
    };

    expect(hasCollectiblePickup({ player, pickups: [pickup] })).toBe(true);
    expect(
      hasCollectiblePickup({
        player: { ...player, health: player.maxHealth },
        pickups: [pickup],
      }),
    ).toBe(false);
    expect(hasCollectiblePickup({ player, pickups: [] })).toBe(false);
  });
});
