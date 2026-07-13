import type { DungeonLayout, RoomKind, RunDirection } from "../core";
import type { GamePreviewPhase } from "./contracts";

export interface PreviewEntityModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  /** Collision radius already converted into preview-canvas coordinates. */
  readonly radius: number;
}

export interface PreviewProjectileModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly owner: "player" | "enemy";
  readonly velocityX: number;
  readonly velocityY: number;
}

export interface PreviewPickupModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: "heart";
}

export interface PreviewRoomConnection {
  readonly direction: RunDirection;
  readonly targetRoomId: string;
  readonly targetKind: RoomKind;
  readonly visited: boolean;
  readonly locked: boolean;
}

export interface PreviewRenderModel {
  readonly phase: GamePreviewPhase;
  readonly elapsedTimeMs: number;
  readonly player: PreviewEntityModel;
  readonly enemies: readonly PreviewEntityModel[];
  readonly projectiles: readonly PreviewProjectileModel[];
  readonly pickups: readonly PreviewPickupModel[];
  readonly floor: number;
  readonly currentRoomId: string;
  readonly roomKind: RoomKind;
  readonly roomCleared: boolean;
  readonly coins: number;
  readonly keys: number;
  readonly shopHeartCost: number;
  readonly dungeon: DungeonLayout;
  readonly visitedRoomIds: readonly string[];
  readonly connections: readonly PreviewRoomConnection[];
}

export function hasCollectiblePickup(
  model: Pick<PreviewRenderModel, "pickups" | "player">,
): boolean {
  return model.pickups.length > 0 && model.player.health < model.player.maxHealth;
}
