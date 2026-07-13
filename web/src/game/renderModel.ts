import type { GamePreviewPhase } from "./contracts";

export interface PreviewEntityModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
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

export interface PreviewRenderModel {
  readonly phase: GamePreviewPhase;
  readonly elapsedTimeMs: number;
  readonly player: PreviewEntityModel;
  readonly enemies: readonly PreviewEntityModel[];
  readonly projectiles: readonly PreviewProjectileModel[];
  readonly pickups: readonly PreviewPickupModel[];
}
