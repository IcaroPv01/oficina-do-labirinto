import type { GameProject } from "./project";
import { hashSeed, nextRandom } from "./rng";

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface SimulationInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly shootX: number;
  readonly shootY: number;
}

export interface PlayerState extends Vector2 {
  readonly health: number;
  readonly fireCooldownRemaining: number;
  readonly invulnerabilityRemaining: number;
}

export interface EnemyState extends Vector2 {
  readonly id: number;
  readonly health: number;
}

export interface ProjectileState extends Vector2 {
  readonly id: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly ageSeconds: number;
}

export interface PickupState extends Vector2 {
  readonly id: number;
  readonly kind: "heart";
}

export type SimulationStatus = "playing" | "cleared" | "game-over";

export type SimulationEvent =
  | { readonly type: "shot"; readonly x: number; readonly y: number }
  | { readonly type: "enemy-hit"; readonly enemyId: number }
  | { readonly type: "enemy-defeated"; readonly enemyId: number }
  | { readonly type: "drop-created"; readonly pickupId: number }
  | { readonly type: "player-damaged"; readonly health: number }
  | { readonly type: "pickup-collected"; readonly pickupId: number }
  | { readonly type: "room-cleared" }
  | { readonly type: "game-over" };

export interface SimulationState {
  readonly seed: string;
  readonly status: SimulationStatus;
  readonly elapsedSeconds: number;
  readonly tick: number;
  readonly rngState: number;
  readonly nextEntityId: number;
  readonly shotsFired: number;
  readonly enemiesDefeated: number;
  readonly player: PlayerState;
  readonly enemies: readonly EnemyState[];
  readonly projectiles: readonly ProjectileState[];
  readonly pickups: readonly PickupState[];
  readonly events: readonly SimulationEvent[];
}

export const EMPTY_INPUT: SimulationInput = {
  moveX: 0,
  moveY: 0,
  shootX: 0,
  shootY: 0,
};

export function createSimulation(project: GameProject): SimulationState {
  let rngState = hashSeed(project.seed);
  let nextEntityId = 1;
  const center = {
    x: project.world.width / 2,
    y: project.world.height / 2,
  };
  const enemies: EnemyState[] = [];

  for (let index = 0; index < project.enemy.spawnCount; index += 1) {
    const angleResult = nextRandom(rngState);
    rngState = angleResult.state;
    const distanceResult = nextRandom(rngState);
    rngState = distanceResult.state;
    const angle = angleResult.value * Math.PI * 2;
    const distance = 145 + distanceResult.value * 75;
    const margin = project.world.wallThickness + project.enemy.radius;
    enemies.push({
      id: nextEntityId,
      health: project.enemy.maxHealth,
      x: clamp(center.x + Math.cos(angle) * distance, margin, project.world.width - margin),
      y: clamp(center.y + Math.sin(angle) * distance, margin, project.world.height - margin),
    });
    nextEntityId += 1;
  }

  return {
    seed: project.seed,
    status: enemies.length > 0 ? "playing" : "cleared",
    elapsedSeconds: 0,
    tick: 0,
    rngState,
    nextEntityId,
    shotsFired: 0,
    enemiesDefeated: 0,
    player: {
      ...center,
      health: project.player.maxHealth,
      fireCooldownRemaining: 0,
      invulnerabilityRemaining: 0,
    },
    enemies,
    projectiles: [],
    pickups: [],
    events: [],
  };
}

export function stepSimulation(
  previous: SimulationState,
  input: SimulationInput,
  requestedDeltaSeconds: number,
  project: GameProject,
): SimulationState {
  const deltaSeconds = clamp(requestedDeltaSeconds, 0, 0.05);

  if (previous.status !== "playing" || deltaSeconds === 0) {
    return { ...previous, events: [] };
  }

  const events: SimulationEvent[] = [];
  let rngState = previous.rngState;
  let nextEntityId = previous.nextEntityId;
  let shotsFired = previous.shotsFired;
  let enemiesDefeated = previous.enemiesDefeated;
  const movement = normalized(input.moveX, input.moveY);
  const playerMargin = project.world.wallThickness + project.player.radius;
  let player: PlayerState = {
    x: clamp(
      previous.player.x + movement.x * project.player.speed * deltaSeconds,
      playerMargin,
      project.world.width - playerMargin,
    ),
    y: clamp(
      previous.player.y + movement.y * project.player.speed * deltaSeconds,
      playerMargin,
      project.world.height - playerMargin,
    ),
    health: previous.player.health,
    fireCooldownRemaining: Math.max(
      0,
      previous.player.fireCooldownRemaining - deltaSeconds,
    ),
    invulnerabilityRemaining: Math.max(
      0,
      previous.player.invulnerabilityRemaining - deltaSeconds,
    ),
  };
  const projectiles: ProjectileState[] = previous.projectiles.map((projectile) => ({
    ...projectile,
    x: projectile.x + projectile.velocityX * deltaSeconds,
    y: projectile.y + projectile.velocityY * deltaSeconds,
    ageSeconds: projectile.ageSeconds + deltaSeconds,
  }));

  const shooting = normalized(input.shootX, input.shootY);
  if ((shooting.x !== 0 || shooting.y !== 0) && player.fireCooldownRemaining <= 0) {
    const spawnDistance = project.player.radius + 8;
    const projectile: ProjectileState = {
      id: nextEntityId,
      x: player.x + shooting.x * spawnDistance,
      y: player.y + shooting.y * spawnDistance,
      velocityX: shooting.x * project.player.projectileSpeed,
      velocityY: shooting.y * project.player.projectileSpeed,
      ageSeconds: 0,
    };
    nextEntityId += 1;
    shotsFired += 1;
    projectiles.push(projectile);
    player = {
      ...player,
      fireCooldownRemaining: project.player.fireCooldownSeconds,
    };
    events.push({ type: "shot", x: projectile.x, y: projectile.y });
  }

  let enemies = previous.enemies.map((enemy): EnemyState => {
    const direction = normalized(player.x - enemy.x, player.y - enemy.y);
    const margin = project.world.wallThickness + project.enemy.radius;
    return {
      ...enemy,
      x: clamp(
        enemy.x + direction.x * project.enemy.speed * deltaSeconds,
        margin,
        project.world.width - margin,
      ),
      y: clamp(
        enemy.y + direction.y * project.enemy.speed * deltaSeconds,
        margin,
        project.world.height - margin,
      ),
    };
  });

  if (player.invulnerabilityRemaining <= 0) {
    const touchingEnemy = enemies.find(
      (enemy) =>
        squaredDistance(enemy, player) <=
        (project.enemy.radius + project.player.radius) ** 2,
    );
    if (touchingEnemy) {
      player = {
        ...player,
        health: Math.max(0, player.health - project.enemy.contactDamage),
        invulnerabilityRemaining: 0.7,
      };
      events.push({ type: "player-damaged", health: player.health });
    }
  }

  const survivingProjectiles: ProjectileState[] = [];
  let pickups = [...previous.pickups];
  for (const projectile of projectiles) {
    if (
      projectile.ageSeconds > 1.5 ||
      projectile.x < project.world.wallThickness ||
      projectile.y < project.world.wallThickness ||
      projectile.x > project.world.width - project.world.wallThickness ||
      projectile.y > project.world.height - project.world.wallThickness
    ) {
      continue;
    }

    const enemyIndex = enemies.findIndex(
      (enemy) =>
        squaredDistance(enemy, projectile) <= (project.enemy.radius + 5) ** 2,
    );
    if (enemyIndex < 0) {
      survivingProjectiles.push(projectile);
      continue;
    }

    const enemy = enemies[enemyIndex];
    if (!enemy) {
      continue;
    }
    const remainingHealth = enemy.health - 1;
    events.push({ type: "enemy-hit", enemyId: enemy.id });

    if (remainingHealth > 0) {
      enemies = enemies.map((candidate, index) =>
        index === enemyIndex ? { ...candidate, health: remainingHealth } : candidate,
      );
      continue;
    }

    enemies = enemies.filter((_, index) => index !== enemyIndex);
    enemiesDefeated += 1;
    events.push({ type: "enemy-defeated", enemyId: enemy.id });
    const dropRoll = nextRandom(rngState);
    rngState = dropRoll.state;
    if (dropRoll.value < project.enemy.dropChance) {
      const pickupId = nextEntityId;
      nextEntityId += 1;
      events.push({ type: "drop-created", pickupId });
      pickups.push({ id: pickupId, kind: "heart", x: enemy.x, y: enemy.y });
    }
  }

  const collectedIds = new Set<number>();
  if (player.health < project.player.maxHealth) {
    for (const pickup of pickups) {
      if (squaredDistance(pickup, player) <= (project.player.radius + 10) ** 2) {
        collectedIds.add(pickup.id);
        events.push({ type: "pickup-collected", pickupId: pickup.id });
        player = {
          ...player,
          health: Math.min(project.player.maxHealth, player.health + 1),
        };
      }
    }
  }
  pickups = pickups.filter((pickup) => !collectedIds.has(pickup.id));

  let status: SimulationStatus = "playing";
  if (player.health <= 0) {
    status = "game-over";
    events.push({ type: "game-over" });
  } else if (enemies.length === 0) {
    status = "cleared";
    events.push({ type: "room-cleared" });
  }

  return {
    seed: previous.seed,
    status,
    elapsedSeconds: previous.elapsedSeconds + deltaSeconds,
    tick: previous.tick + 1,
    rngState,
    nextEntityId,
    shotsFired,
    enemiesDefeated,
    player,
    enemies,
    projectiles: survivingProjectiles,
    pickups,
    events,
  };
}

function normalized(x: number, y: number): Vector2 {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
}

function squaredDistance(a: Vector2, b: Vector2): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
