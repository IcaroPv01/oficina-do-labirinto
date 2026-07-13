import {
  DEFAULT_GAME_PROJECT,
  createRun,
  getCurrentRunRoom,
  safeParseGameProject,
  stepRun,
  type DungeonRoom,
  type GameProject,
  type RoomReward,
  type RunDirection,
  type RunEvent,
  type RunInput,
  type RunState,
  type SimulationEvent,
  type SimulationState,
} from "../core";

import type { GamePreviewPhase } from "./contracts";
import type { PreviewRenderModel, PreviewRoomConnection } from "./renderModel";
import { ROOM_BOUNDS } from "./roomBackdrop";
import type {
  PreviewFeedback,
  PreviewInputState,
  PreviewNoticeTone,
  PreviewSimulationFrame,
  PreviewSimulationPort,
} from "./simulationPort";

const DIRECTION_LABELS: Readonly<Record<RunDirection, string>> = {
  north: "norte",
  south: "sul",
  east: "leste",
  west: "oeste",
};

function phaseFromState(state: RunState, simulation: SimulationState): GamePreviewPhase {
  if (state.status === "completed") {
    return "victory";
  }
  if (state.status === "game-over" || simulation.status === "game-over") {
    return "game-over";
  }
  return simulation.status === "cleared" ? "room-cleared" : "playing";
}
function notice(message: string, tone: PreviewNoticeTone): PreviewFeedback {
  return { type: "notice", message, tone };
}

function simulationFeedback(roomId: string, event: SimulationEvent): PreviewFeedback | null {
  switch (event.type) {
    case "enemy-hit":
      return { type: "enemy-hit", enemyId: `${roomId}:enemy-${event.enemyId}` };
    case "enemy-defeated":
      return { type: "enemy-defeated", enemyId: `${roomId}:enemy-${event.enemyId}` };
    case "player-damaged":
      return { type: "player-hit" };
    case "pickup-collected":
      return notice("Coração recuperado: +1 de vida.", "success");
    case "room-cleared":
      return notice("Sala limpa. Escolha uma porta com WASD.", "success");
    case "game-over":
      return notice("A expedição terminou. Pressione R para recomeçar.", "error");
    case "shot":
    case "drop-created":
      return null;
  }
}

function rewardMessage(reward: RoomReward): string {
  const parts: string[] = [];
  if (reward.coins > 0) {
    parts.push(`+${reward.coins} moeda${reward.coins === 1 ? "" : "s"}`);
  }
  if (reward.keys > 0) {
    parts.push(`+${reward.keys} chave${reward.keys === 1 ? "" : "s"}`);
  }
  if (reward.health > 0) {
    parts.push(`+${reward.health} vida`);
  }
  return parts.length > 0 ? `Recompensa: ${parts.join(", ")}.` : "Sala concluída.";
}

function feedbackFromEvent(event: RunEvent): PreviewFeedback | null {
  switch (event.type) {
    case "simulation-event":
      return simulationFeedback(event.roomId, event.event);
    case "room-entered":
      return notice(`Você entrou em uma sala ${roomKindLabel(event.roomKind)}.`, "info");
    case "room-transition-blocked":
      if (event.reason === "room-not-cleared") {
        return notice("A porta permanece selada enquanto houver inimigos.", "warning");
      }
      if (event.reason === "key-required") {
        return notice("Essa porta de tesouro exige uma chave.", "warning");
      }
      return notice(`Não existe passagem para ${DIRECTION_LABELS[event.direction]}.`, "warning");
    case "key-spent":
      return notice("Uma chave abriu a sala de tesouro.", "info");
    case "room-reward":
      return notice(rewardMessage(event.reward), "success");
    case "purchase-succeeded":
      return notice(`Coração comprado por ${event.cost} moedas.`, "success");
    case "purchase-failed":
      if (event.reason === "health-full") {
        return notice("Sua vida já está cheia.", "warning");
      }
      if (event.reason === "insufficient-coins") {
        return notice(`São necessárias ${event.cost} moedas para comprar o coração.`, "warning");
      }
      return notice("Corações só podem ser comprados na loja.", "warning");
    case "descend-blocked":
      return notice(
        event.reason === "boss-not-cleared"
          ? "Derrote o chefe antes de descer."
          : "A saída para o próximo andar fica na sala do chefe.",
        "warning",
      );
    case "floor-advanced":
      return notice(`Andar ${event.toFloor} iniciado.`, "success");
    case "run-won":
      return notice(`Vitória! A expedição foi concluída no andar ${event.floor}.`, "success");
    case "run-lost":
      return notice(`Expedição encerrada no andar ${event.floor}.`, "error");
  }
}

function roomKindLabel(kind: PreviewRenderModel["roomKind"]): string {
  switch (kind) {
    case "start":
      return "inicial";
    case "combat":
      return "de combate";
    case "treasure":
      return "de tesouro";
    case "shop":
      return "de loja";
    case "boss":
      return "de chefe";
  }
}

function connectionDirection(current: DungeonRoom, target: DungeonRoom): RunDirection {
  if (target.y < current.y) {
    return "north";
  }
  if (target.y > current.y) {
    return "south";
  }
  return target.x > current.x ? "east" : "west";
}

export class CoreSimulationPort implements PreviewSimulationPort {
  private project: GameProject = DEFAULT_GAME_PROJECT;
  private state: RunState = createRun(DEFAULT_GAME_PROJECT);

  public reset(project: unknown, _seed: string): PreviewSimulationFrame {
    const parsed = safeParseGameProject(project);
    this.project = parsed.success ? parsed.data : DEFAULT_GAME_PROJECT;
    this.state = createRun(this.project);
    return this.toFrame();
  }

  public step(input: PreviewInputState, deltaMs: number): PreviewSimulationFrame {
    const runInput: RunInput = {
      moveX: input.moveX,
      moveY: input.moveY,
      shootX: input.fire ? input.aimX : 0,
      shootY: input.fire ? input.aimY : 0,
      ...(input.transition ? { transition: input.transition } : {}),
      ...(input.action ? { action: input.action } : {}),
    };
    this.state = stepRun(this.state, runInput, deltaMs / 1000, this.project);
    return this.toFrame();
  }

  public current(): PreviewSimulationFrame {
    return this.toFrame();
  }

  private toFrame(): PreviewSimulationFrame {
    const currentRoom = getCurrentRunRoom(this.state);
    const simulation = currentRoom.simulation;
    const roomWidth = ROOM_BOUNDS.right - ROOM_BOUNDS.left;
    const roomHeight = ROOM_BOUNDS.bottom - ROOM_BOUNDS.top;
    const displayX = (x: number): number =>
      ROOM_BOUNDS.left + (x / this.project.world.width) * roomWidth;
    const displayY = (y: number): number =>
      ROOM_BOUNDS.top + (y / this.project.world.height) * roomHeight;
    const displayRadius = (radius: number): number =>
      radius *
      Math.min(
        roomWidth / this.project.world.width,
        roomHeight / this.project.world.height,
      );
    const enemyMaxHealth =
      currentRoom.kind === "boss"
        ? this.project.enemy.maxHealth * (this.state.floor + 2)
        : currentRoom.kind === "combat"
          ? this.project.enemy.maxHealth + Math.floor((this.state.floor - 1) / 2)
          : this.project.enemy.maxHealth;
    const roomId = currentRoom.roomId;
    const dungeonRoom = this.state.dungeon.rooms.find((room) => room.id === roomId);
    if (!dungeonRoom) {
      throw new Error(`Sala ${roomId} não encontrada no mapa da run.`);
    }
    const progressById = new Map(this.state.rooms.map((room) => [room.roomId, room]));
    const connections: PreviewRoomConnection[] = dungeonRoom.connections.map((targetId) => {
      const target = this.state.dungeon.rooms.find((room) => room.id === targetId);
      const progress = progressById.get(targetId);
      if (!target || !progress) {
        throw new Error(`Conexão inválida da sala ${roomId} para ${targetId}.`);
      }
      return {
        direction: connectionDirection(dungeonRoom, target),
        targetRoomId: target.id,
        targetKind: target.kind,
        visited: progress.visited,
        locked: target.kind === "treasure" && !progress.visited && this.state.keys < 1,
      };
    });
    const model: PreviewRenderModel = {
      phase: phaseFromState(this.state, simulation),
      elapsedTimeMs: this.state.elapsedSeconds * 1000,
      player: {
        id: "player",
        x: displayX(simulation.player.x),
        y: displayY(simulation.player.y),
        health: simulation.player.health,
        maxHealth: this.project.player.maxHealth,
        radius: displayRadius(this.project.player.radius),
      },
      enemies: simulation.enemies.map((enemy) => ({
        id: `${roomId}:enemy-${enemy.id}`,
        x: displayX(enemy.x),
        y: displayY(enemy.y),
        health: enemy.health,
        maxHealth: enemyMaxHealth,
        radius: displayRadius(this.project.enemy.radius),
      })),
      projectiles: simulation.projectiles.map((projectile) => ({
        id: `${roomId}:projectile-${projectile.id}`,
        x: displayX(projectile.x),
        y: displayY(projectile.y),
        owner: "player" as const,
        velocityX: projectile.velocityX * (roomWidth / this.project.world.width),
        velocityY: projectile.velocityY * (roomHeight / this.project.world.height),
      })),
      pickups: simulation.pickups.map((pickup) => ({
        id: `${roomId}:pickup-${pickup.id}`,
        x: displayX(pickup.x),
        y: displayY(pickup.y),
        kind: pickup.kind,
      })),
      floor: this.state.floor,
      currentRoomId: roomId,
      roomKind: currentRoom.kind,
      roomCleared: currentRoom.cleared,
      coins: this.state.coins,
      keys: this.state.keys,
      shopHeartCost: this.project.run.shopHeartCost,
      dungeon: this.state.dungeon,
      visitedRoomIds: this.state.rooms
        .filter((room) => room.visited)
        .map((room) => room.roomId),
      connections,
    };

    return {
      model,
      feedback: this.state.events
        .map(feedbackFromEvent)
        .filter((feedback): feedback is PreviewFeedback => feedback !== null),
    };
  }
}
