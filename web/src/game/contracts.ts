import type { DungeonLayout, RoomKind } from "../core";

export type GamePreviewPhase =
  | "loading"
  | "playing"
  | "paused"
  | "room-cleared"
  | "victory"
  | "game-over"
  | "destroyed";

export interface GamePreviewPoint {
  readonly x: number;
  readonly y: number;
}

export interface GamePreviewSnapshot {
  readonly phase: GamePreviewPhase;
  readonly seed: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly enemyCount: number;
  readonly projectileCount: number;
  readonly elapsedTimeMs: number;
  readonly playerPosition: GamePreviewPoint;
  readonly paused: boolean;
  readonly floor: number;
  readonly currentRoomId: string;
  readonly roomKind: RoomKind;
  readonly coins: number;
  readonly keys: number;
  readonly shopHeartCost: number;
  readonly dungeon: DungeonLayout;
  readonly visitedRoomIds: readonly string[];
}

export interface GamePreviewStatus {
  readonly phase: GamePreviewPhase;
  readonly label: string;
  readonly seed: string;
}

export type GamePreviewAnnouncementTone =
  | "info"
  | "success"
  | "warning"
  | "error";

export interface GamePreviewAnnouncement {
  readonly message: string;
  readonly tone: GamePreviewAnnouncementTone;
}

export interface GamePreviewOptions {
  /** Focuses the canvas after boot. Opt-in so the editor keeps keyboard control. */
  readonly autoFocus?: boolean;
  /** Disables decorative camera effects while preserving gameplay feedback. */
  readonly reducedMotion?: boolean;
  readonly onStatusChange?: (status: GamePreviewStatus) => void;
  /** Discrete gameplay feedback suitable for an editor-level live region. */
  readonly onAnnouncement?: (announcement: GamePreviewAnnouncement) => void;
  /** Throttled semantic state for tests, accessibility and editor diagnostics. */
  readonly onSnapshot?: (snapshot: GamePreviewSnapshot) => void;
}
