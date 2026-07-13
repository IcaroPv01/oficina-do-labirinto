import type { RunAction, RunDirection } from "../core";
import type { GamePreviewAnnouncementTone } from "./contracts";
import type { PreviewRenderModel } from "./renderModel";

export interface PreviewInputState {
  readonly moveX: number;
  readonly moveY: number;
  readonly aimX: number;
  readonly aimY: number;
  readonly fire: boolean;
  readonly transition: RunDirection | null;
  readonly action: RunAction | null;
}

export type PreviewNoticeTone = GamePreviewAnnouncementTone;

export type PreviewFeedback =
  | { readonly type: "player-hit" }
  | { readonly type: "enemy-hit"; readonly enemyId: string }
  | { readonly type: "enemy-defeated"; readonly enemyId: string }
  | {
      readonly type: "notice";
      readonly message: string;
      readonly tone: PreviewNoticeTone;
    };

export interface PreviewSimulationFrame {
  readonly model: PreviewRenderModel;
  readonly feedback: readonly PreviewFeedback[];
}

export interface PreviewSimulationPort {
  reset(project: unknown, seed: string): PreviewSimulationFrame;
  step(input: PreviewInputState, deltaMs: number): PreviewSimulationFrame;
  current(): PreviewSimulationFrame;
}
