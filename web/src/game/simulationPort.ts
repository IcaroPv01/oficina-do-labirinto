import type { PreviewRenderModel } from "./renderModel";

export interface PreviewInputState {
  readonly moveX: number;
  readonly moveY: number;
  readonly aimX: number;
  readonly aimY: number;
  readonly fire: boolean;
}

export type PreviewFeedback =
  | { readonly type: "player-hit" }
  | { readonly type: "enemy-hit"; readonly enemyId: string }
  | { readonly type: "enemy-defeated"; readonly enemyId: string };

export interface PreviewSimulationFrame {
  readonly model: PreviewRenderModel;
  readonly feedback: readonly PreviewFeedback[];
}

export interface PreviewSimulationPort {
  reset(project: unknown, seed: string): PreviewSimulationFrame;
  step(input: PreviewInputState, deltaMs: number): PreviewSimulationFrame;
  current(): PreviewSimulationFrame;
}

