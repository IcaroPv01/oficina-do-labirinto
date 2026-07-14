import Phaser from "phaser";

import "./touchControls.css";

import type { GameProject } from "../core";
import type { GamePreviewOptions } from "./contracts";
import { CoreSimulationPort } from "./coreSimulationPort";
import { PreviewScene } from "./PreviewScene";
import { GAME_HEIGHT, GAME_WIDTH } from "./roomBackdrop";
import {
  createGameTouchControls,
  type GameTouchControlsHandle,
} from "./touchControls";

export type {
  GamePreviewAnnouncement,
  GamePreviewAnnouncementTone,
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
  const stage = document.createElement("div");
  stage.className = "game-preview__stage";
  const host = document.createElement("div");
  host.className = "game-preview__canvas-host";
  host.style.width = "100%";
  host.style.maxWidth = `${GAME_WIDTH}px`;
  host.style.aspectRatio = `${GAME_WIDTH} / ${GAME_HEIGHT}`;
  host.style.margin = "0 auto";
  host.style.overflow = "hidden";
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", "Estado atual da prévia jogável");

  let touchControlHandle: GameTouchControlsHandle | null = null;
  const scene = new PreviewScene(new CoreSimulationPort(), project, {
    ...options,
    onStatusChange(status) {
      touchControlHandle?.setPaused(status.phase === "paused");
      options.onStatusChange?.(status);
    },
  });
  const touchControls = createGameTouchControls(document, {
    onMove(direction, active) {
      scene.setVirtualMove(direction, active);
    },
    onAim(direction, active) {
      scene.setVirtualAim(direction, active);
    },
    onAction() {
      scene.triggerVirtualAction();
    },
    onPause() {
      scene.togglePreviewPaused();
    },
    onRestart() {
      scene.restartPreview();
    },
  });
  touchControlHandle = touchControls.handle;
  touchControlHandle.setPaused(false);
  stage.append(host, touchControls.element);
  container.replaceChildren(stage);

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
      touchControlHandle?.destroy();
      touchControlHandle = null;
      game.destroy(true);
      stage.remove();
      delete container.dataset["gameStatus"];
      delete container.dataset["gameSeed"];
      delete container.dataset["gameHealth"];
      delete container.dataset["gameEnemies"];
      delete container.dataset["gameProjectiles"];
      delete container.dataset["gameElapsedMs"];
      delete container.dataset["gamePlayerX"];
      delete container.dataset["gamePlayerY"];
      delete container.dataset["gameFloor"];
      delete container.dataset["gameRoom"];
      delete container.dataset["gameRoomKind"];
      delete container.dataset["gameCoins"];
      delete container.dataset["gameKeys"];
      delete container.dataset["gameVisitedRooms"];
      delete container.dataset["gameMessage"];
    },
  };
}
