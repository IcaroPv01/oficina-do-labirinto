export type GamePreviewPhase =
  | "loading"
  | "playing"
  | "paused"
  | "room-cleared"
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
}

export interface GamePreviewStatus {
  readonly phase: GamePreviewPhase;
  readonly label: string;
  readonly seed: string;
}

export interface GamePreviewOptions {
  /** Focuses the canvas after boot. Opt-in so the editor keeps keyboard control. */
  readonly autoFocus?: boolean;
  /** Disables decorative camera effects while preserving gameplay feedback. */
  readonly reducedMotion?: boolean;
  readonly onStatusChange?: (status: GamePreviewStatus) => void;
  /** Throttled semantic state for tests, accessibility and editor diagnostics. */
  readonly onSnapshot?: (snapshot: GamePreviewSnapshot) => void;
}

