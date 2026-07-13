import {
  DEFAULT_GAME_PROJECT,
  createSimulation,
  safeParseGameProject,
  stepSimulation,
  type GameProject,
  type SimulationEvent,
  type SimulationState,
} from "../core";

import type { GamePreviewPhase } from "./contracts";
import type { PreviewRenderModel } from "./renderModel";
import { ROOM_BOUNDS } from "./roomBackdrop";
import type {
  PreviewFeedback,
  PreviewInputState,
  PreviewSimulationFrame,
  PreviewSimulationPort,
} from "./simulationPort";

function phaseFromState(state: SimulationState): GamePreviewPhase {
  switch (state.status) {
    case "playing":
      return "playing";
    case "cleared":
      return "room-cleared";
    case "game-over":
      return "game-over";
  }
}

function feedbackFromEvent(event: SimulationEvent): PreviewFeedback | null {
  switch (event.type) {
    case "enemy-hit":
      return { type: "enemy-hit", enemyId: `enemy-${event.enemyId}` };
    case "enemy-defeated":
      return { type: "enemy-defeated", enemyId: `enemy-${event.enemyId}` };
    case "player-damaged":
      return { type: "player-hit" };
    default:
      return null;
  }
}

export class CoreSimulationPort implements PreviewSimulationPort {
  private project: GameProject = DEFAULT_GAME_PROJECT;
  private state: SimulationState = createSimulation(DEFAULT_GAME_PROJECT);

  public reset(project: unknown, _seed: string): PreviewSimulationFrame {
    const parsed = safeParseGameProject(project);
    this.project = parsed.success ? parsed.data : DEFAULT_GAME_PROJECT;
    this.state = createSimulation(this.project);
    return this.toFrame();
  }

  public step(input: PreviewInputState, deltaMs: number): PreviewSimulationFrame {
    this.state = stepSimulation(
      this.state,
      {
        moveX: input.moveX,
        moveY: input.moveY,
        shootX: input.fire ? input.aimX : 0,
        shootY: input.fire ? input.aimY : 0,
      },
      deltaMs / 1000,
      this.project,
    );
    return this.toFrame();
  }

  public current(): PreviewSimulationFrame {
    return this.toFrame();
  }

  private toFrame(): PreviewSimulationFrame {
    const roomWidth = ROOM_BOUNDS.right - ROOM_BOUNDS.left;
    const roomHeight = ROOM_BOUNDS.bottom - ROOM_BOUNDS.top;
    const displayX = (x: number): number => ROOM_BOUNDS.left + (x / this.project.world.width) * roomWidth;
    const displayY = (y: number): number => ROOM_BOUNDS.top + (y / this.project.world.height) * roomHeight;
    const model: PreviewRenderModel = {
      phase: phaseFromState(this.state),
      elapsedTimeMs: this.state.elapsedSeconds * 1000,
      player: {
        id: "player",
        x: displayX(this.state.player.x),
        y: displayY(this.state.player.y),
        health: this.state.player.health,
        maxHealth: this.project.player.maxHealth,
      },
      enemies: this.state.enemies.map((enemy) => ({
        id: `enemy-${enemy.id}`,
        x: displayX(enemy.x),
        y: displayY(enemy.y),
        health: enemy.health,
        maxHealth: this.project.enemy.maxHealth,
      })),
      projectiles: this.state.projectiles.map((projectile) => ({
        id: `projectile-${projectile.id}`,
        x: displayX(projectile.x),
        y: displayY(projectile.y),
        owner: "player" as const,
        velocityX: projectile.velocityX * (roomWidth / this.project.world.width),
        velocityY: projectile.velocityY * (roomHeight / this.project.world.height),
      })),
      pickups: this.state.pickups.map((pickup) => ({
        id: `pickup-${pickup.id}`,
        x: displayX(pickup.x),
        y: displayY(pickup.y),
        kind: pickup.kind,
      })),
    };

    return {
      model,
      feedback: this.state.events
        .map(feedbackFromEvent)
        .filter((feedback): feedback is PreviewFeedback => feedback !== null),
    };
  }
}
