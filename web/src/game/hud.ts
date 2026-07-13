import type Phaser from "phaser";

import type { RoomKind } from "../core";
import type { GamePreviewSnapshot } from "./contracts";
import { GAME_HEIGHT, GAME_WIDTH } from "./roomBackdrop";
import type { PreviewNoticeTone } from "./simulationPort";

const FONT_FAMILY = '"Courier New", "Lucida Console", monospace';

export function compactHudLabel(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maximumCharacters - 1))}…`;
}

function roomKindLabel(kind: RoomKind): string {
  switch (kind) {
    case "start":
      return "INÍCIO";
    case "combat":
      return "COMBATE";
    case "treasure":
      return "TESOURO";
    case "shop":
      return "LOJA";
    case "boss":
      return "CHEFE";
  }
}

function phaseMessage(snapshot: GamePreviewSnapshot): {
  readonly heading: string;
  readonly detail: string;
} | null {
  switch (snapshot.phase) {
    case "loading":
      return { heading: "PREPARANDO SALA", detail: "Carregando a simulação local..." };
    case "paused":
      return { heading: "PAUSADO", detail: "Esc para continuar" };
    case "room-cleared":
      if (snapshot.roomKind === "shop") {
        return {
          heading: "LOJA SEGURA",
          detail: `Espaço compra 1 coração por ${snapshot.shopHeartCost} moedas · WASD usa uma porta`,
        };
      }
      if (snapshot.roomKind === "boss") {
        return { heading: "CHEFE DERROTADO", detail: "Espaço desce · WASD retorna por uma porta" };
      }
      return { heading: "SALA CONCLUÍDA", detail: "Pressione novamente WASD na direção de uma porta" };
    case "victory":
      return { heading: "EXPEDIÇÃO CONCLUÍDA", detail: "Vitória! R inicia uma nova expedição" };
    case "game-over":
      return { heading: "VOCÊ CAIU", detail: "R para tentar novamente" };
    case "destroyed":
    case "playing":
      return null;
  }
}

function controlHint(snapshot: GamePreviewSnapshot): string {
  const special =
    snapshot.roomKind === "shop"
      ? "Espaço comprar"
      : snapshot.roomKind === "boss" && snapshot.phase === "room-cleared"
        ? "Espaço descer"
        : "WASD mover/portas";
  return `${special}  ·  Setas atirar  ·  Esc pausar  ·  R reiniciar`;
}

const FEEDBACK_COLORS: Readonly<Record<PreviewNoticeTone, number>> = {
  info: 0x63b3ed,
  success: 0x5ce1c6,
  warning: 0xf5bd4f,
  error: 0xe05a76,
};

export class PreviewHud {
  private readonly chrome: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly seed: Phaser.GameObjects.Text;
  private readonly floor: Phaser.GameObjects.Text;
  private readonly room: Phaser.GameObjects.Text;
  private readonly health: Phaser.GameObjects.Text;
  private readonly enemies: Phaser.GameObjects.Text;
  private readonly resources: Phaser.GameObjects.Text;
  private readonly controls: Phaser.GameObjects.Text;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly overlayHeading: Phaser.GameObjects.Text;
  private readonly overlayDetail: Phaser.GameObjects.Text;
  private readonly feedbackBackground: Phaser.GameObjects.Graphics;
  private readonly feedbackText: Phaser.GameObjects.Text;
  private feedbackGeneration = 0;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly onFeedbackHidden: () => void = () => {},
  ) {
    this.chrome = scene.add.graphics().setDepth(100);
    this.chrome.fillStyle(0x07101b, 0.96);
    this.chrome.fillRect(0, 0, GAME_WIDTH, 62);
    this.chrome.fillRect(0, GAME_HEIGHT - 36, GAME_WIDTH, 36);
    this.chrome.lineStyle(2, 0x5ce1c6, 0.45);
    this.chrome.lineBetween(0, 62, GAME_WIDTH, 62);

    const strongStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#e8fff8",
      fontFamily: FONT_FAMILY,
      fontSize: "16px",
      fontStyle: "bold",
    };
    const smallStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#a7bac5",
      fontFamily: FONT_FAMILY,
      fontSize: "13px",
    };

    this.title = scene.add.text(18, 10, "", strongStyle).setDepth(101);
    this.seed = scene.add.text(18, 37, "", smallStyle).setDepth(101);
    this.floor = scene.add.text(345, 10, "", strongStyle).setDepth(101);
    this.room = scene.add.text(345, 37, "", smallStyle).setDepth(101);
    this.health = scene.add.text(510, 10, "", strongStyle).setDepth(101);
    this.enemies = scene.add.text(510, 37, "", smallStyle).setDepth(101);
    this.resources = scene.add
      .text(700, 10, "", {
        ...strongStyle,
        color: "#ffd98a",
        lineSpacing: 5,
      })
      .setDepth(101);
    this.controls = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 18, "", {
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
        fontSize: "30px",
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
        fontSize: "15px",
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setVisible(false);

    this.feedbackBackground = scene.add.graphics().setDepth(150).setVisible(false);
    this.feedbackText = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 58, "", {
        align: "center",
        color: "#ffffff",
        fontFamily: FONT_FAMILY,
        fontSize: "14px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(151)
      .setVisible(false);
  }

  public update(title: string, snapshot: GamePreviewSnapshot): void {
    this.title.setText(compactHudLabel(title.toUpperCase(), 28));
    this.seed.setText(`SEED  ${compactHudLabel(snapshot.seed, 34)}`);
    this.floor.setText(`ANDAR  ${snapshot.floor}`);
    this.room.setText(`SALA  ${roomKindLabel(snapshot.roomKind)}`);
    this.health.setText(`VIDA  ${snapshot.health}/${snapshot.maxHealth}`);
    this.enemies.setText(`INIMIGOS  ${snapshot.enemyCount}`);
    this.resources.setText(`MOEDAS  ${snapshot.coins}\nCHAVES  ${snapshot.keys}`);
    this.controls.setText(controlHint(snapshot));

    const message = phaseMessage(snapshot);
    const visible = message !== null;
    this.overlay.setVisible(visible);
    this.overlayHeading.setVisible(visible);
    this.overlayDetail.setVisible(visible);

    if (!message) {
      return;
    }

    this.overlay.clear();
    const isRoomComplete = snapshot.phase === "room-cleared";
    if (isRoomComplete) {
      this.overlay.fillStyle(0x0b1925, 0.94);
      this.overlay.fillRoundedRect(GAME_WIDTH / 2 - 285, 78, 570, 76, 10);
      this.overlay.lineStyle(2, 0x5ce1c6, 0.8);
      this.overlay.strokeRoundedRect(GAME_WIDTH / 2 - 285, 78, 570, 76, 10);
      this.overlayHeading.setPosition(GAME_WIDTH / 2, 101).setFontSize(21);
      this.overlayDetail.setPosition(GAME_WIDTH / 2, 132).setFontSize(13);
    } else {
      this.overlay.fillStyle(0x03070d, 0.68);
      this.overlay.fillRect(0, 62, GAME_WIDTH, GAME_HEIGHT - 98);
      this.overlay.fillStyle(0x122536, 0.97);
      this.overlay.fillRoundedRect(GAME_WIDTH / 2 - 250, GAME_HEIGHT / 2 - 76, 500, 152, 12);
      this.overlay.lineStyle(3, snapshot.phase === "game-over" ? 0xe05a76 : 0x5ce1c6, 0.9);
      this.overlay.strokeRoundedRect(GAME_WIDTH / 2 - 250, GAME_HEIGHT / 2 - 76, 500, 152, 12);
      this.overlayHeading.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20).setFontSize(30);
      this.overlayDetail.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 26).setFontSize(15);
    }
    this.overlayHeading.setText(message.heading);
    this.overlayDetail.setText(message.detail);
  }

  public showFeedback(message: string, tone: PreviewNoticeTone): void {
    this.feedbackGeneration += 1;
    const generation = this.feedbackGeneration;
    const color = FEEDBACK_COLORS[tone];
    this.feedbackText.setText(message).setVisible(true);
    const width = Math.min(760, Math.max(260, this.feedbackText.width + 38));
    this.feedbackBackground.clear();
    this.feedbackBackground.fillStyle(0x06101a, 0.96);
    this.feedbackBackground.fillRoundedRect(GAME_WIDTH / 2 - width / 2, GAME_HEIGHT - 78, width, 38, 8);
    this.feedbackBackground.lineStyle(2, color, 0.95);
    this.feedbackBackground.strokeRoundedRect(GAME_WIDTH / 2 - width / 2, GAME_HEIGHT - 78, width, 38, 8);
    this.feedbackBackground.setVisible(true);

    this.scene.time.delayedCall(2_100, () => {
      if (generation === this.feedbackGeneration) {
        this.feedbackBackground.setVisible(false);
        this.feedbackText.setVisible(false);
        this.onFeedbackHidden();
      }
    });
  }

  public clearFeedback(): void {
    this.feedbackGeneration += 1;
    this.feedbackBackground.setVisible(false);
    this.feedbackText.setVisible(false).setText("");
    this.onFeedbackHidden();
  }

  public destroy(): void {
    this.feedbackGeneration += 1;
    this.chrome.destroy();
    this.title.destroy();
    this.seed.destroy();
    this.floor.destroy();
    this.room.destroy();
    this.health.destroy();
    this.enemies.destroy();
    this.resources.destroy();
    this.controls.destroy();
    this.overlay.destroy();
    this.overlayHeading.destroy();
    this.overlayDetail.destroy();
    this.feedbackBackground.destroy();
    this.feedbackText.destroy();
  }
}
