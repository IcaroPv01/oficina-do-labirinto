import Phaser from "phaser";

import type { GamePreviewOptions, GamePreviewPhase, GamePreviewSnapshot, GamePreviewStatus } from "./contracts";
import { EntityView } from "./entityView";
import { PreviewHud } from "./hud";
import { readProjectPresentation } from "./projectPresentation";
import type { ProjectPresentation } from "./projectPresentation";
import { RoomBackdrop } from "./roomBackdrop";
import type { PreviewSimulationFrame, PreviewSimulationPort } from "./simulationPort";
import { ensurePreviewTextures } from "./textures";

interface KeyMap {
  readonly moveUp: Phaser.Input.Keyboard.Key;
  readonly moveDown: Phaser.Input.Keyboard.Key;
  readonly moveLeft: Phaser.Input.Keyboard.Key;
  readonly moveRight: Phaser.Input.Keyboard.Key;
  readonly fireUp: Phaser.Input.Keyboard.Key;
  readonly fireDown: Phaser.Input.Keyboard.Key;
  readonly fireLeft: Phaser.Input.Keyboard.Key;
  readonly fireRight: Phaser.Input.Keyboard.Key;
}

const STATUS_LABELS: Readonly<Record<GamePreviewPhase, string>> = {
  loading: "Preparando a sala",
  playing: "Jogando",
  paused: "Jogo pausado",
  "room-cleared": "Sala limpa. Vitória",
  "game-over": "Fim de jogo",
  destroyed: "Prévia encerrada",
};

const SNAPSHOT_INTERVAL_MS = 100;

export class PreviewScene extends Phaser.Scene {
  private readonly simulation: PreviewSimulationPort;
  private readonly options: GamePreviewOptions;
  private project: unknown;
  private presentation: ProjectPresentation;
  private keys: KeyMap | null = null;
  private backdrop: RoomBackdrop | null = null;
  private entities: EntityView | null = null;
  private hud: PreviewHud | null = null;
  private frame: PreviewSimulationFrame | null = null;
  private previewPaused = false;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private lastStatusKey = "";
  private disposed = false;

  public constructor(simulation: PreviewSimulationPort, project: unknown, options: GamePreviewOptions) {
    super({ key: "GamePreview" });
    this.simulation = simulation;
    this.project = project;
    this.options = options;
    this.presentation = readProjectPresentation(project);
  }

  public create(): void {
    ensurePreviewTextures(this);
    this.backdrop = new RoomBackdrop(this);
    this.entities = new EntityView(this);
    this.hud = new PreviewHud(this);
    this.keys = this.createKeys();
    this.input.keyboard?.on("keydown-ESC", this.handlePauseKey, this);
    this.input.keyboard?.on("keydown-R", this.handleRestartKey, this);

    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Prévia jogável da sala. Clique para controlar.");
    canvas.style.imageRendering = "pixelated";
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.focusCanvas, this);

    this.resetSimulation();
    if (this.options.autoFocus === true) {
      this.focusCanvas();
    }
  }

  public override update(_time: number, delta: number): void {
    if (this.disposed || !this.frame || !this.keys || !this.hasKeyboardFocus()) {
      return;
    }

    if (this.previewPaused || this.isTerminal(this.frame.model.phase)) {
      return;
    }

    const input = this.readInput();
    this.frame = this.simulation.step(input, Math.min(50, Math.max(0, delta)));
    this.renderFrame(this.frame, false);
  }

  public updateProject(project: unknown): void {
    this.project = project;
    this.presentation = readProjectPresentation(project);
    if (this.sys.isActive()) {
      this.resetSimulation();
    }
  }

  public restartPreview(): void {
    if (this.sys.isActive()) {
      this.resetSimulation();
    }
  }

  public setPreviewPaused(paused: boolean): void {
    if (!this.frame || this.isTerminal(this.frame.model.phase)) {
      return;
    }
    this.previewPaused = paused;
    this.renderFrame(this.frame, true);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.focusCanvas, this);
    this.input.keyboard?.off("keydown-ESC", this.handlePauseKey, this);
    this.input.keyboard?.off("keydown-R", this.handleRestartKey, this);
    this.backdrop?.destroy();
    this.entities?.destroy();
    this.hud?.destroy();
    this.backdrop = null;
    this.entities = null;
    this.hud = null;
    this.keys = null;
    this.frame = null;
    this.emitStatus("destroyed");
  }

  private createKeys(): KeyMap | null {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return null;
    }

    return {
      moveUp: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      moveDown: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      moveLeft: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      moveRight: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      fireUp: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      fireDown: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      fireLeft: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      fireRight: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    };
  }

  private handlePauseKey(event: KeyboardEvent): void {
    if (event.repeat || !this.hasKeyboardFocus()) {
      return;
    }
    event.preventDefault();
    this.setPreviewPaused(!this.previewPaused);
  }

  private handleRestartKey(event: KeyboardEvent): void {
    if (event.repeat || !this.hasKeyboardFocus()) {
      return;
    }
    event.preventDefault();
    this.restartPreview();
  }

  private resetSimulation(): void {
    this.previewPaused = false;
    this.presentation = readProjectPresentation(this.project);
    this.backdrop?.redraw(this.presentation.seed, this.presentation);
    this.entities?.setPalette(
      this.presentation.playerColor,
      this.presentation.playerAccentColor,
      this.presentation.enemyColor,
    );
    this.entities?.setPlayerSkin(this.presentation.playerSkinDataUrl);
    this.frame = this.simulation.reset(this.project, this.presentation.seed);
    this.lastSnapshotAt = Number.NEGATIVE_INFINITY;
    this.lastStatusKey = "";
    this.renderFrame(this.frame, true);
  }

  private readInput(): {
    readonly moveX: number;
    readonly moveY: number;
    readonly aimX: number;
    readonly aimY: number;
    readonly fire: boolean;
  } {
    if (!this.keys) {
      return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };
    }

    const moveX = Number(this.keys.moveRight.isDown) - Number(this.keys.moveLeft.isDown);
    const moveY = Number(this.keys.moveDown.isDown) - Number(this.keys.moveUp.isDown);
    const aimX = Number(this.keys.fireRight.isDown) - Number(this.keys.fireLeft.isDown);
    const aimY = Number(this.keys.fireDown.isDown) - Number(this.keys.fireUp.isDown);
    return { moveX, moveY, aimX, aimY, fire: aimX !== 0 || aimY !== 0 };
  }

  private renderFrame(frame: PreviewSimulationFrame, forceSnapshot: boolean): void {
    this.entities?.sync(frame.model);
    for (const feedback of frame.feedback) {
      if (feedback.type === "player-hit") {
        this.entities?.flashPlayer();
        if (this.options.reducedMotion !== true) {
          this.cameras.main.shake(70, 0.004);
        }
      } else {
        this.entities?.flashEnemy(feedback.enemyId);
      }
    }

    const snapshot = this.createSnapshot(frame);
    this.hud?.update(this.presentation.title, snapshot);
    this.emitStatus(snapshot.phase);
    this.updateSemanticState(snapshot);

    if (forceSnapshot || frame.model.elapsedTimeMs - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = frame.model.elapsedTimeMs;
      this.invokeSafely(() => this.options.onSnapshot?.(snapshot));
    }
  }

  private createSnapshot(frame: PreviewSimulationFrame): GamePreviewSnapshot {
    const phase = this.previewPaused ? "paused" : frame.model.phase;
    return {
      phase,
      seed: this.presentation.seed,
      health: Math.max(0, frame.model.player.health),
      maxHealth: Math.max(1, frame.model.player.maxHealth),
      enemyCount: frame.model.enemies.length,
      projectileCount: frame.model.projectiles.length,
      elapsedTimeMs: frame.model.elapsedTimeMs,
      playerPosition: { x: frame.model.player.x, y: frame.model.player.y },
      paused: this.previewPaused,
    };
  }

  private emitStatus(phase: GamePreviewPhase): void {
    const status: GamePreviewStatus = {
      phase,
      label: STATUS_LABELS[phase],
      seed: this.presentation.seed,
    };
    const key = `${status.phase}:${status.seed}`;
    if (key === this.lastStatusKey) {
      return;
    }
    this.lastStatusKey = key;
    this.invokeSafely(() => this.options.onStatusChange?.(status));
  }

  private updateSemanticState(snapshot: GamePreviewSnapshot): void {
    const parent = this.game.canvas.parentElement;
    if (!parent) {
      return;
    }
    parent.dataset["gameStatus"] = snapshot.phase;
    parent.dataset["gameSeed"] = snapshot.seed;
    parent.dataset["gameHealth"] = String(snapshot.health);
    parent.dataset["gameEnemies"] = String(snapshot.enemyCount);
    parent.dataset["gameProjectiles"] = String(snapshot.projectileCount);
    parent.dataset["gamePlayerX"] = String(Math.round(snapshot.playerPosition.x));
    parent.dataset["gamePlayerY"] = String(Math.round(snapshot.playerPosition.y));
    parent.setAttribute(
      "aria-label",
      `${STATUS_LABELS[snapshot.phase]}. Seed ${snapshot.seed}. Vida ${snapshot.health} de ${snapshot.maxHealth}. ${snapshot.enemyCount} inimigos.`,
    );
  }

  private hasKeyboardFocus(): boolean {
    const active = document.activeElement;
    const canvas = this.game.canvas;
    return active === canvas || (active instanceof HTMLElement && canvas.parentElement?.contains(active) === true);
  }

  private focusCanvas(): void {
    this.game.canvas.focus({ preventScroll: true });
  }

  private isTerminal(phase: GamePreviewPhase): boolean {
    return phase === "game-over" || phase === "room-cleared" || phase === "destroyed";
  }

  private invokeSafely(callback: () => void): void {
    try {
      callback();
    } catch (error: unknown) {
      console.error("Callback da prévia falhou:", error);
    }
  }
}
