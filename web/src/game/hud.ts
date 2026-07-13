import type Phaser from "phaser";

import type { GamePreviewPhase, GamePreviewSnapshot } from "./contracts";
import { GAME_HEIGHT, GAME_WIDTH } from "./roomBackdrop";

const FONT_FAMILY = '"Courier New", "Lucida Console", monospace';

function phaseMessage(phase: GamePreviewPhase): { readonly heading: string; readonly detail: string } | null {
  switch (phase) {
    case "loading":
      return { heading: "PREPARANDO SALA", detail: "Carregando a simulação local..." };
    case "paused":
      return { heading: "PAUSADO", detail: "Esc para continuar" };
    case "room-cleared":
      return { heading: "SALA LIMPA", detail: "Vitória! R para jogar novamente" };
    case "game-over":
      return { heading: "VOCÊ CAIU", detail: "R para tentar novamente" };
    case "destroyed":
      return null;
    case "playing":
      return null;
  }
}

export class PreviewHud {
  private readonly chrome: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly seed: Phaser.GameObjects.Text;
  private readonly health: Phaser.GameObjects.Text;
  private readonly enemies: Phaser.GameObjects.Text;
  private readonly controls: Phaser.GameObjects.Text;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly overlayHeading: Phaser.GameObjects.Text;
  private readonly overlayDetail: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene) {
    this.chrome = scene.add.graphics().setDepth(100);
    this.chrome.fillStyle(0x07101b, 0.96);
    this.chrome.fillRect(0, 0, GAME_WIDTH, 62);
    this.chrome.fillRect(0, GAME_HEIGHT - 36, GAME_WIDTH, 36);
    this.chrome.lineStyle(2, 0x5ce1c6, 0.45);
    this.chrome.lineBetween(0, 62, GAME_WIDTH, 62);

    const baseStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#e8fff8",
      fontFamily: FONT_FAMILY,
      fontSize: "18px",
      fontStyle: "bold",
    };

    this.title = scene.add.text(22, 12, "", baseStyle).setDepth(101);
    this.seed = scene.add
      .text(22, 38, "", {
        color: "#93a9b7",
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
      })
      .setDepth(101);
    this.health = scene.add.text(590, 16, "", baseStyle).setDepth(101);
    this.enemies = scene.add.text(760, 16, "", baseStyle).setDepth(101);
    this.controls = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 18, "WASD mover  ·  Setas atirar  ·  Esc pausar  ·  R reiniciar", {
        align: "center",
        color: "#a7bac5",
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
      })
      .setOrigin(0.5)
      .setDepth(101);

    this.overlay = scene.add.graphics().setDepth(200).setVisible(false);
    this.overlayHeading = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, "", {
        align: "center",
        color: "#fff6d7",
        fontFamily: FONT_FAMILY,
        fontSize: "32px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setVisible(false);
    this.overlayDetail = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 26, "", {
        align: "center",
        color: "#d5e7eb",
        fontFamily: FONT_FAMILY,
        fontSize: "16px",
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setVisible(false);
  }

  public update(title: string, snapshot: GamePreviewSnapshot): void {
    this.title.setText(title.toUpperCase());
    this.seed.setText(`SEED  ${snapshot.seed}`);
    this.health.setText(`VIDA  ${snapshot.health}/${snapshot.maxHealth}`);
    this.enemies.setText(`INIMIGOS  ${snapshot.enemyCount}`);

    const message = phaseMessage(snapshot.phase);
    const visible = message !== null;
    this.overlay.setVisible(visible);
    this.overlayHeading.setVisible(visible);
    this.overlayDetail.setVisible(visible);

    if (!message) {
      return;
    }

    this.overlay.clear();
    this.overlay.fillStyle(0x03070d, 0.68);
    this.overlay.fillRect(0, 62, GAME_WIDTH, GAME_HEIGHT - 98);
    this.overlay.fillStyle(0x122536, 0.97);
    this.overlay.fillRoundedRect(GAME_WIDTH / 2 - 230, GAME_HEIGHT / 2 - 72, 460, 144, 12);
    this.overlay.lineStyle(3, snapshot.phase === "game-over" ? 0xe05a76 : 0x5ce1c6, 0.9);
    this.overlay.strokeRoundedRect(GAME_WIDTH / 2 - 230, GAME_HEIGHT / 2 - 72, 460, 144, 12);
    this.overlayHeading.setText(message.heading);
    this.overlayDetail.setText(message.detail);
  }

  public destroy(): void {
    this.chrome.destroy();
    this.title.destroy();
    this.seed.destroy();
    this.health.destroy();
    this.enemies.destroy();
    this.controls.destroy();
    this.overlay.destroy();
    this.overlayHeading.destroy();
    this.overlayDetail.destroy();
  }
}

