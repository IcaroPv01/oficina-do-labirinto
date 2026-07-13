import Phaser from "phaser";

import type { GameProject } from "../core";
import type { GamePreviewOptions } from "./contracts";
import { CoreSimulationPort } from "./coreSimulationPort";
import { PreviewScene } from "./PreviewScene";
import { GAME_HEIGHT, GAME_WIDTH } from "./roomBackdrop";

export type {
  GamePreviewOptions,
  GamePreviewPhase,
  GamePreviewPoint,
  GamePreviewSnapshot,
  GamePreviewStatus,
} from "./contracts";

export interface GamePreviewHandle {
  updateProject(project: GameProject): void;
  restart(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function createGamePreview(
  container: HTMLElement,
  project: GameProject,
  options: GamePreviewOptions = {},
): GamePreviewHandle {
  const host = document.createElement("div");
  host.className = "game-preview__canvas-host";
  host.style.width = "100%";
  host.style.maxWidth = `${GAME_WIDTH}px`;
  host.style.aspectRatio = `${GAME_WIDTH} / ${GAME_HEIGHT}`;
  host.style.margin = "0 auto";
  host.style.overflow = "hidden";
  container.replaceChildren(host);

  const scene = new PreviewScene(new CoreSimulationPort(), project, options);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#09111f",
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      expandParent: false,
    },
    scene: [scene],
  });
  let destroyed = false;

  const ifAlive = (action: () => void): void => {
    if (!destroyed) {
      action();
    }
  };

  return {
    updateProject(nextProject) {
      ifAlive(() => scene.updateProject(nextProject));
    },
    restart() {
      ifAlive(() => scene.restartPreview());
    },
    pause() {
      ifAlive(() => scene.setPreviewPaused(true));
    },
    resume() {
      ifAlive(() => scene.setPreviewPaused(false));
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      if (game.scene.isActive(scene)) {
        scene.dispose();
      }
      game.destroy(true);
      host.remove();
      delete container.dataset["gameStatus"];
      delete container.dataset["gameSeed"];
      delete container.dataset["gameHealth"];
      delete container.dataset["gameEnemies"];
      delete container.dataset["gameProjectiles"];
      delete container.dataset["gamePlayerX"];
      delete container.dataset["gamePlayerY"];
    },
  };
}
