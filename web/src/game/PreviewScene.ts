import Phaser from "phaser";

import type { RunAction, RunDirection } from "../core";
import type { GamePreviewOptions, GamePreviewPhase, GamePreviewSnapshot, GamePreviewStatus } from "./contracts";
import { EntityView } from "./entityView";
import { advanceFixedClock, FIXED_STEP_MS } from "./fixedStep";
import { PreviewHud } from "./hud";
import { readProjectPresentation } from "./projectPresentation";
import type { ProjectPresentation } from "./projectPresentation";
import { RoomBackdrop } from "./roomBackdrop";
import type { PreviewSimulationFrame, PreviewSimulationPort } from "./simulationPort";
import { hasCollectiblePickup } from "./renderModel";
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
  "room-cleared": "Sala concluída. Escolha uma porta",
  victory: "Expedição concluída. Vitória",
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
  private lastSnapshotSemanticKey = "";
  private lastStatusKey = "";
  private fixedRemainderMs = 0;
  private pendingTransition: RunDirection | null = null;
  private pendingAction: RunAction | null = null;
  private backdropStateKey = "";
  private lastFeedbackMessage = "";
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
    this.hud = new PreviewHud(this, () => this.clearSemanticFeedback());
    this.keys = this.createKeys();
    this.input.keyboard?.on("keydown-ESC", this.handlePauseKey, this);
    this.input.keyboard?.on("keydown-R", this.handleRestartKey, this);
    this.input.keyboard?.on("keydown-W", this.handleNorthKey, this);
    this.input.keyboard?.on("keydown-S", this.handleSouthKey, this);
    this.input.keyboard?.on("keydown-A", this.handleWestKey, this);
    this.input.keyboard?.on("keydown-D", this.handleEastKey, this);
    this.input.keyboard?.on("keydown-SPACE", this.handleActionKey, this);

    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute(
      "aria-label",
      "Prévia jogável da expedição. Clique para controlar com o teclado.",
    );
    canvas.setAttribute("aria-describedby", "preview-controls");
    canvas.setAttribute(
      "aria-keyshortcuts",
      "W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Space Escape R",
    );
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

    if (
      this.frame.model.phase === "room-cleared" &&
      !hasCollectiblePickup(this.frame.model) &&
      this.pendingTransition === null &&
      this.pendingAction === null
    ) {
      this.fixedRemainderMs = 0;
      return;
    }

    const clock = advanceFixedClock(this.fixedRemainderMs, delta);
    this.fixedRemainderMs = clock.remainderMs;
    if (clock.stepCount === 0) {
      return;
    }

    const heldInput = this.readInput();
    const transition = this.pendingTransition;
    const action = this.pendingAction;
    this.pendingTransition = null;
    this.pendingAction = null;
    const feedback: PreviewSimulationFrame["feedback"][number][] = [];
    let nextFrame = this.frame;
    for (let step = 0; step < clock.stepCount; step += 1) {
      nextFrame = this.simulation.step(
        {
          ...heldInput,
          transition: step === 0 ? transition : null,
          action: step === 0 ? action : null,
        },
        FIXED_STEP_MS,
      );
      feedback.push(...nextFrame.feedback);
      if (this.isTerminal(nextFrame.model.phase)) {
        break;
      }
    }
    this.frame = { ...nextFrame, feedback };
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
      this.focusCanvas();
    }
  }

  public setPreviewPaused(paused: boolean): void {
    if (!this.frame || this.isTerminal(this.frame.model.phase)) {
      return;
    }
    this.previewPaused = paused;
    if (!paused) {
      this.focusCanvas();
    }
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
    this.input.keyboard?.off("keydown-W", this.handleNorthKey, this);
    this.input.keyboard?.off("keydown-S", this.handleSouthKey, this);
    this.input.keyboard?.off("keydown-A", this.handleWestKey, this);
    this.input.keyboard?.off("keydown-D", this.handleEastKey, this);
    this.input.keyboard?.off("keydown-SPACE", this.handleActionKey, this);
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

  private handleNorthKey(event: KeyboardEvent): void {
    this.queueTransition("north", event);
  }

  private handleSouthKey(event: KeyboardEvent): void {
    this.queueTransition("south", event);
  }

  private handleWestKey(event: KeyboardEvent): void {
    this.queueTransition("west", event);
  }

  private handleEastKey(event: KeyboardEvent): void {
    this.queueTransition("east", event);
  }

  private queueTransition(direction: RunDirection, event: KeyboardEvent): void {
    if (
      event.repeat ||
      !this.hasKeyboardFocus() ||
      !this.frame?.model.roomCleared ||
      hasCollectiblePickup(this.frame.model) ||
      this.isTerminal(this.frame.model.phase)
    ) {
      return;
    }
    event.preventDefault();
    this.pendingTransition ??= direction;
  }

  private handleActionKey(event: KeyboardEvent): void {
    if (event.repeat || !this.hasKeyboardFocus() || !this.frame || this.isTerminal(this.frame.model.phase)) {
      return;
    }
    const { roomKind } = this.frame.model;
    if (roomKind !== "shop" && roomKind !== "boss") {
      return;
    }
    event.preventDefault();
    if (roomKind === "boss" && !this.frame.model.roomCleared) {
      return;
    }
    this.pendingAction ??= roomKind === "shop" ? "buy-heart" : "descend";
  }

  private resetSimulation(): void {
    this.previewPaused = false;
    this.fixedRemainderMs = 0;
    this.pendingTransition = null;
    this.pendingAction = null;
    this.backdropStateKey = "";
    this.lastFeedbackMessage = "";
    this.presentation = readProjectPresentation(this.project);
    this.entities?.setPalette(
      this.presentation.playerColor,
      this.presentation.playerAccentColor,
      this.presentation.enemyColor,
    );
    this.entities?.setPlayerSkin(this.presentation.playerSkinDataUrl);
    this.frame = this.simulation.reset(this.project, this.presentation.seed);
    this.hud?.clearFeedback();
    this.lastSnapshotAt = Number.NEGATIVE_INFINITY;
    this.lastSnapshotSemanticKey = "";
    this.lastStatusKey = "";
    this.renderFrame(this.frame, true);
  }

  private readInput(): {
    readonly moveX: number;
    readonly moveY: number;
    readonly aimX: number;
    readonly aimY: number;
    readonly fire: boolean;
    readonly transition: null;
    readonly action: null;
  } {
    if (!this.keys) {
      return {
        moveX: 0,
        moveY: 0,
        aimX: 0,
        aimY: 0,
        fire: false,
        transition: null,
        action: null,
      };
    }

    const moveX = Number(this.keys.moveRight.isDown) - Number(this.keys.moveLeft.isDown);
    const moveY = Number(this.keys.moveDown.isDown) - Number(this.keys.moveUp.isDown);
    const aimX = Number(this.keys.fireRight.isDown) - Number(this.keys.fireLeft.isDown);
    const aimY = Number(this.keys.fireDown.isDown) - Number(this.keys.fireUp.isDown);
    return {
      moveX,
      moveY,
      aimX,
      aimY,
      fire: aimX !== 0 || aimY !== 0,
      transition: null,
      action: null,
    };
  }

  private renderFrame(frame: PreviewSimulationFrame, forceSnapshot: boolean): void {
    this.redrawBackdrop(frame);
    this.entities?.sync(frame.model);
    for (const feedback of frame.feedback) {
      if (feedback.type === "player-hit") {
        this.entities?.flashPlayer();
        if (this.options.reducedMotion !== true) {
          this.cameras.main.shake(70, 0.004);
        }
      } else if (feedback.type === "notice") {
        this.lastFeedbackMessage = feedback.message;
        this.hud?.showFeedback(feedback.message, feedback.tone);
        this.invokeSafely(() =>
          this.options.onAnnouncement?.({
            message: feedback.message,
            tone: feedback.tone,
          }),
        );
      } else {
        this.entities?.flashEnemy(feedback.enemyId);
      }
    }

    const snapshot = this.createSnapshot(frame);
    this.hud?.update(this.presentation.title, snapshot);
    this.emitStatus(snapshot.phase);
    this.updateSemanticState(snapshot);

    const semanticKey = [
      snapshot.phase,
      snapshot.floor,
      snapshot.currentRoomId,
      snapshot.roomKind,
      snapshot.health,
      snapshot.enemyCount,
      snapshot.coins,
      snapshot.keys,
      snapshot.visitedRoomIds.join(","),
    ].join(":");
    if (
      forceSnapshot ||
      semanticKey !== this.lastSnapshotSemanticKey ||
      frame.model.elapsedTimeMs - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
    ) {
      this.lastSnapshotAt = frame.model.elapsedTimeMs;
      this.lastSnapshotSemanticKey = semanticKey;
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
      floor: frame.model.floor,
      currentRoomId: frame.model.currentRoomId,
      roomKind: frame.model.roomKind,
      coins: frame.model.coins,
      keys: frame.model.keys,
      shopHeartCost: frame.model.shopHeartCost,
      dungeon: frame.model.dungeon,
      visitedRoomIds: frame.model.visitedRoomIds,
    };
  }

  private emitStatus(phase: GamePreviewPhase): void {
    const status: GamePreviewStatus = {
      phase,
      label: STATUS_LABELS[phase],
      seed: this.presentation.seed,
    };
    const key = `${status.phase}:${status.seed}:${this.frame?.model.floor ?? 0}:${this.frame?.model.currentRoomId ?? ""}`;
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
    parent.dataset["gameFloor"] = String(snapshot.floor);
    parent.dataset["gameRoom"] = snapshot.currentRoomId;
    parent.dataset["gameRoomKind"] = snapshot.roomKind;
    parent.dataset["gameCoins"] = String(snapshot.coins);
    parent.dataset["gameKeys"] = String(snapshot.keys);
    parent.dataset["gameVisitedRooms"] = snapshot.visitedRoomIds.join(",");
    if (this.lastFeedbackMessage.length > 0) {
      parent.dataset["gameMessage"] = this.lastFeedbackMessage;
    }
    const semanticLabel = `${STATUS_LABELS[snapshot.phase]}. Andar ${snapshot.floor}. Sala ${snapshot.roomKind}. Vida ${snapshot.health} de ${snapshot.maxHealth}. ${snapshot.enemyCount} inimigos. ${snapshot.coins} moedas e ${snapshot.keys} chaves.${this.lastFeedbackMessage ? ` ${this.lastFeedbackMessage}` : ""}`;
    if (parent.getAttribute("aria-label") !== semanticLabel) {
      parent.setAttribute("aria-label", semanticLabel);
    }

    const canvas = this.game.canvas;
    const canvasLabel = `${semanticLabel} Use WASD para mover, setas para atirar, espaço para interagir, Escape para pausar e R para reiniciar.`;
    if (canvas.getAttribute("aria-label") !== canvasLabel) {
      canvas.setAttribute("aria-label", canvasLabel);
    }
  }

  private clearSemanticFeedback(): void {
    if (this.lastFeedbackMessage.length === 0) {
      return;
    }
    this.lastFeedbackMessage = "";
    const parent = this.game.canvas.parentElement;
    if (parent) {
      delete parent.dataset["gameMessage"];
    }
    if (this.frame) {
      this.updateSemanticState(this.createSnapshot(this.frame));
    }
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
    return phase === "game-over" || phase === "victory" || phase === "destroyed";
  }

  private redrawBackdrop(frame: PreviewSimulationFrame): void {
    const model = frame.model;
    const connectionKey = model.connections
      .map((connection) => `${connection.direction}:${connection.visited}:${connection.locked}`)
      .sort()
      .join("|");
    const key = `${model.floor}:${model.currentRoomId}:${model.roomCleared}:${connectionKey}`;
    if (key === this.backdropStateKey) {
      return;
    }
    this.backdropStateKey = key;
    this.backdrop?.redraw(
      `${this.presentation.seed}:floor:${model.floor}:${model.currentRoomId}`,
      this.presentation,
      model.connections,
      model.roomCleared,
    );
  }

  private invokeSafely(callback: () => void): void {
    try {
      callback();
    } catch (error: unknown) {
      console.error("Callback da prévia falhou:", error);
    }
  }
}
