import {
  ChangeOperationsSchema,
  type ChangeOperation,
  type SandboxCheck,
} from "@collaborative-roguelike/studio-contracts";
import { z } from "zod";
import {
  cloneGameProject,
  createSimulation,
  safeParseGameProject,
  stepSimulation,
  type GameProject,
  type SimulationInput,
  type SimulationState,
  type SimulationStatus,
} from "../core";

export const DEFAULT_CANDIDATE_SANDBOX_LIMITS = {
  maxSteps: 600,
  maxEntities: 64,
  maxElapsedSeconds: 10,
  stepSeconds: 1 / 60,
} as const;

export interface CandidateSandboxLimits {
  readonly maxSteps: number;
  readonly maxEntities: number;
  readonly maxElapsedSeconds: number;
  readonly stepSeconds: number;
}

export type CandidateSandboxOptions = Partial<CandidateSandboxLimits>;

export type CandidateSandboxCheck = SandboxCheck;

export type CandidateSandboxDiffValue = string | number | boolean | null;

export interface CandidateSandboxDiffEntry {
  readonly operationId: string;
  readonly path: string;
  readonly before: CandidateSandboxDiffValue;
  readonly after: CandidateSandboxDiffValue;
}

export interface CandidateSandboxDiff {
  readonly changedFieldCount: number;
  readonly summary: string;
  readonly entries: readonly CandidateSandboxDiffEntry[];
}

export type CandidateSimulationTermination =
  | "step-limit"
  | "time-limit"
  | "terminal-state"
  | "entity-limit"
  | "invalid-state";

export interface CandidateSimulationSummary {
  readonly executedSteps: number;
  readonly simulatedSeconds: number;
  readonly finalStatus: SimulationStatus;
  readonly finalEntityCount: number;
  readonly peakEntityCount: number;
  readonly termination: CandidateSimulationTermination;
  readonly deterministic: boolean;
}

export interface CandidateSandboxResult {
  readonly status: "passed" | "failed";
  /** Null means that no complete, reviewable candidate could be produced. */
  readonly candidate: GameProject | null;
  readonly checks: readonly CandidateSandboxCheck[];
  readonly diff: CandidateSandboxDiff;
  readonly simulation: CandidateSimulationSummary | null;
}

const CandidateSandboxLimitsSchema = z
  .object({
    maxSteps: z
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(DEFAULT_CANDIDATE_SANDBOX_LIMITS.maxSteps),
    maxEntities: z
      .number()
      .int()
      .min(1)
      .max(512)
      .default(DEFAULT_CANDIDATE_SANDBOX_LIMITS.maxEntities),
    maxElapsedSeconds: z
      .number()
      .positive()
      .max(60)
      .default(DEFAULT_CANDIDATE_SANDBOX_LIMITS.maxElapsedSeconds),
    stepSeconds: z
      .number()
      .min(1 / 240)
      .max(0.05)
      .default(DEFAULT_CANDIDATE_SANDBOX_LIMITS.stepSeconds),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.maxElapsedSeconds < limits.stepSeconds) {
      context.addIssue({
        code: "custom",
        path: ["maxElapsedSeconds"],
        message: "O limite de tempo precisa comportar pelo menos um passo.",
      });
    }
  });

const PLAYER_TUNING_FIELDS = [
  "color",
  "accentColor",
  "maxHealth",
  "speed",
  "radius",
  "fireCooldownSeconds",
  "projectileSpeed",
] as const;

const ENEMY_TUNING_FIELDS = [
  "name",
  "color",
  "maxHealth",
  "speed",
  "radius",
  "spawnCount",
  "contactDamage",
  "dropChance",
] as const;

const WORLD_STYLE_FIELDS = [
  "width",
  "height",
  "wallThickness",
  "backgroundColor",
  "floorColor",
  "wallColor",
] as const;

const RUN_SETTING_FIELDS = [
  "endless",
  "floorLimit",
  "roomsPerFloor",
  "startingCoins",
  "startingKeys",
  "shopHeartCost",
] as const;

const MOVEMENT_PHASES = [
  { moveX: 1, moveY: 0 },
  { moveX: 0, moveY: 1 },
  { moveX: -1, moveY: 0 },
  { moveX: 0, moveY: -1 },
] as const;

const TIME_EPSILON_SECONDS = 1e-9;

type AssetOperation = Extract<
  ChangeOperation,
  { readonly kind: "asset.add" | "asset.replace" | "asset.remove" }
>;

interface AppliedCandidate {
  readonly project: GameProject;
  readonly diff: CandidateSandboxDiff;
}

interface SimulationExecution {
  readonly state: SimulationState;
  readonly executedSteps: number;
  readonly peakEntityCount: number;
  readonly termination: CandidateSimulationTermination;
  readonly failure: "entity-limit" | "invalid-state" | null;
}

/**
 * Applies one validated operation set to an isolated project clone and runs a
 * deterministic, bounded core smoke simulation. All expected and unexpected
 * input failures are represented in the result; this function never throws.
 */
export function runCandidateSandbox(
  baseProject: unknown,
  operations: unknown,
  options?: CandidateSandboxOptions,
): CandidateSandboxResult {
  try {
    return evaluateCandidateSandbox(baseProject, operations, options);
  } catch {
    return failedResult([
      makeCheck(
        "candidate-internal-error",
        "O motor candidato concluiu sem exceção externa",
        "failed",
        "O motor conteve uma falha interna inesperada; nenhum candidato foi produzido.",
      ),
    ]);
  }
}

function evaluateCandidateSandbox(
  baseProject: unknown,
  operations: unknown,
  options: CandidateSandboxOptions | undefined,
): CandidateSandboxResult {
  const checks: CandidateSandboxCheck[] = [];
  const parsedBase = safeParseGameProject(baseProject);
  checks.push(
    parsedBase.success
      ? makeCheck(
          "candidate-base-project",
          "O projeto base respeita o contrato GameProject",
          "passed",
          `Projeto ${parsedBase.data.id} validado sem alterar a entrada original.`,
        )
      : makeCheck(
          "candidate-base-project",
          "O projeto base respeita o contrato GameProject",
          "failed",
          summarizeIssues(parsedBase.error),
        ),
  );

  const parsedOperations = ChangeOperationsSchema.safeParse(operations);
  checks.push(
    parsedOperations.success
      ? makeCheck(
          "candidate-operations-contract",
          "As operações respeitam o contrato fechado de mudanças",
          "passed",
          `${parsedOperations.data.length} operação(ões) validada(s) por ChangeOperationsSchema.`,
        )
      : makeCheck(
          "candidate-operations-contract",
          "As operações respeitam o contrato fechado de mudanças",
          "failed",
          summarizeIssues(parsedOperations.error),
        ),
  );

  const parsedLimits = CandidateSandboxLimitsSchema.safeParse(
    options === undefined ? {} : options,
  );
  checks.push(
    parsedLimits.success
      ? makeCheck(
          "candidate-execution-limits",
          "A execução possui limites seguros e finitos",
          "passed",
          `${parsedLimits.data.maxSteps} passos, ${parsedLimits.data.maxEntities} entidades e ${formatSeconds(parsedLimits.data.maxElapsedSeconds)} s no máximo.`,
        )
      : makeCheck(
          "candidate-execution-limits",
          "A execução possui limites seguros e finitos",
          "failed",
          summarizeIssues(parsedLimits.error),
        ),
  );

  if (!parsedBase.success || !parsedOperations.success || !parsedLimits.success) {
    return failedResult(checks);
  }

  const assetOperations = parsedOperations.data.filter(isAssetOperation);
  if (assetOperations.length > 0) {
    checks.push(
      makeCheck(
        "candidate-asset-content",
        "O conteúdo binário necessário para assets está disponível",
        "failed",
        describeUnavailableAssets(assetOperations),
      ),
    );
    return failedResult(checks);
  }

  checks.push(
    makeCheck(
      "candidate-asset-content",
      "O conteúdo binário necessário para assets está disponível",
      "passed",
      "Nenhuma operação deste candidato depende de conteúdo binário externo.",
    ),
  );

  let applied: AppliedCandidate;
  try {
    applied = applyOperations(parsedBase.data, parsedOperations.data);
  } catch {
    checks.push(
      makeCheck(
        "candidate-operations-applied",
        "As operações foram aplicadas ao clone isolado",
        "failed",
        "Uma operação validada não pôde ser incorporada; o projeto base permaneceu intacto.",
      ),
    );
    return failedResult(checks);
  }

  checks.push(
    makeCheck(
      "candidate-operations-applied",
      "As operações foram aplicadas ao clone isolado",
      "passed",
      `${parsedOperations.data.length} operação(ões) aplicada(s); ${applied.diff.changedFieldCount} campo(s) efetivamente alterado(s).`,
    ),
  );

  if (applied.diff.changedFieldCount === 0) {
    checks.push(
      makeCheck(
        "candidate-effective-change",
        "O candidato contém ao menos uma mudança efetiva",
        "failed",
        "As operações não alteram nenhum valor do projeto base; um candidato no-op não pode seguir para aprovação.",
      ),
    );
    return failedResult(checks, applied.diff);
  }

  checks.push(
    makeCheck(
      "candidate-effective-change",
      "O candidato contém ao menos uma mudança efetiva",
      "passed",
      `${applied.diff.changedFieldCount} campo(s) apresenta(m) valor diferente do projeto base.`,
    ),
  );

  const parsedCandidate = safeParseGameProject(applied.project);
  if (!parsedCandidate.success) {
    checks.push(
      makeCheck(
        "candidate-result-project",
        "O projeto candidato final respeita GameProject",
        "failed",
        summarizeIssues(parsedCandidate.error),
      ),
    );
    return failedResult(checks, applied.diff);
  }

  checks.push(
    makeCheck(
      "candidate-result-project",
      "O projeto candidato final respeita GameProject",
      "passed",
      "O candidato completo foi revalidado depois da aplicação das operações.",
    ),
  );

  let simulationResult: ReturnType<typeof runBoundedSimulation>;
  try {
    simulationResult = runBoundedSimulation(
      parsedCandidate.data,
      parsedLimits.data,
    );
  } catch {
    checks.push(
      makeCheck(
        "candidate-core-simulation",
        "A simulação core é determinística e respeita os limites",
        "failed",
        "A simulação core falhou de forma contida; o candidato válido foi preservado para inspeção.",
      ),
    );
    return resultFrom(
      "failed",
      parsedCandidate.data,
      checks,
      applied.diff,
      null,
    );
  }

  checks.push(simulationResult.check);
  return resultFrom(
    simulationResult.check.status,
    parsedCandidate.data,
    checks,
    applied.diff,
    simulationResult.summary,
  );
}

function applyOperations(
  baseProject: GameProject,
  operations: readonly ChangeOperation[],
): AppliedCandidate {
  let candidate = cloneGameProject(baseProject);
  const entries: CandidateSandboxDiffEntry[] = [];

  for (const operation of operations) {
    switch (operation.kind) {
      case "project.set-name":
        appendPrimitiveDiff(
          entries,
          operation.operationId,
          "project.name",
          candidate.name,
          operation.name,
        );
        candidate = { ...candidate, name: operation.name };
        break;
      case "project.set-seed":
        appendPrimitiveDiff(
          entries,
          operation.operationId,
          "project.seed",
          candidate.seed,
          operation.seed,
        );
        candidate = { ...candidate, seed: operation.seed };
        break;
      case "player.set-tuning":
        for (const field of PLAYER_TUNING_FIELDS) {
          const after = operation.tuning[field];
          if (after !== undefined) {
            appendPrimitiveDiff(
              entries,
              operation.operationId,
              `player.${field}`,
              candidate.player[field],
              after,
            );
          }
        }
        Object.assign(candidate.player, definedProperties(operation.tuning));
        break;
      case "enemy.set-tuning":
        for (const field of ENEMY_TUNING_FIELDS) {
          const after = operation.tuning[field];
          if (after !== undefined) {
            appendPrimitiveDiff(
              entries,
              operation.operationId,
              `enemy.${field}`,
              candidate.enemy[field],
              after,
            );
          }
        }
        Object.assign(candidate.enemy, definedProperties(operation.tuning));
        break;
      case "enemy.set-behavior": {
        const before = candidate.enemy.behavior;
        if (JSON.stringify(before) !== JSON.stringify(operation.behavior)) {
          entries.push({
            operationId: operation.operationId,
            path: "enemy.behavior",
            before: summarizeBehavior(before),
            after: summarizeBehavior(operation.behavior),
          });
        }
        candidate = {
          ...candidate,
          enemy: { ...candidate.enemy, behavior: operation.behavior },
        };
        break;
      }
      case "world.set-style":
        for (const field of WORLD_STYLE_FIELDS) {
          const after = operation.style[field];
          if (after !== undefined) {
            appendPrimitiveDiff(
              entries,
              operation.operationId,
              `world.${field}`,
              candidate.world[field],
              after,
            );
          }
        }
        Object.assign(candidate.world, definedProperties(operation.style));
        break;
      case "run.set-settings":
        for (const field of RUN_SETTING_FIELDS) {
          const after = operation.settings[field];
          if (after !== undefined) {
            appendPrimitiveDiff(
              entries,
              operation.operationId,
              `run.${field}`,
              candidate.run[field],
              after,
            );
          }
        }
        Object.assign(candidate.run, definedProperties(operation.settings));
        break;
      case "asset.add":
      case "asset.replace":
      case "asset.remove":
        throw new Error("Asset operation reached application without binary preflight.");
    }
  }

  return { project: candidate, diff: buildDiff(entries) };
}

function runBoundedSimulation(
  project: GameProject,
  limits: CandidateSandboxLimits,
): {
  readonly check: CandidateSandboxCheck;
  readonly summary: CandidateSimulationSummary;
} {
  const first = executeSimulation(project, limits);
  const second = executeSimulation(project, limits);
  const deterministic = simulationsMatch(first, second);
  const summary: CandidateSimulationSummary = {
    executedSteps: first.executedSteps,
    simulatedSeconds: finiteOrZero(first.state.elapsedSeconds),
    finalStatus: first.state.status,
    finalEntityCount: entityCount(first.state),
    peakEntityCount: first.peakEntityCount,
    termination: first.termination,
    deterministic,
  };

  if (first.failure === "invalid-state" || second.failure === "invalid-state") {
    return {
      summary,
      check: makeCheck(
        "candidate-core-simulation",
        "A simulação core é determinística e respeita os limites",
        "failed",
        "A simulação produziu um estado numérico ou estrutural inválido e foi interrompida.",
      ),
    };
  }

  if (first.failure === "entity-limit" || second.failure === "entity-limit") {
    return {
      summary,
      check: makeCheck(
        "candidate-core-simulation",
        "A simulação core é determinística e respeita os limites",
        "failed",
        `A execução foi interrompida ao observar ${Math.max(first.peakEntityCount, second.peakEntityCount)} entidades; o limite é ${limits.maxEntities}.`,
      ),
    };
  }

  if (!deterministic) {
    return {
      summary,
      check: makeCheck(
        "candidate-core-simulation",
        "A simulação core é determinística e respeita os limites",
        "failed",
        "Duas execuções com o mesmo projeto, seed e roteiro produziram estados diferentes.",
      ),
    };
  }

  return {
    summary,
    check: makeCheck(
      "candidate-core-simulation",
      "A simulação core é determinística e respeita os limites",
      "passed",
      `${summary.executedSteps} passo(s), ${formatSeconds(summary.simulatedSeconds)} s simulados e pico de ${summary.peakEntityCount}/${limits.maxEntities} entidades; término: ${summary.termination}.`,
    ),
  };
}

function executeSimulation(
  project: GameProject,
  limits: CandidateSandboxLimits,
): SimulationExecution {
  let state = createSimulation(project, {
    seed: `${project.seed}:candidate-sandbox:v1`,
  });
  let peakEntityCount = entityCount(state);
  const timeStepBudget = Math.floor(
    limits.maxElapsedSeconds / limits.stepSeconds,
  );
  const stepBudget = Math.min(limits.maxSteps, timeStepBudget);
  const budgetTermination: CandidateSimulationTermination =
    limits.maxSteps <= timeStepBudget ? "step-limit" : "time-limit";

  if (!isSimulationStateValid(state, project)) {
    return {
      state,
      executedSteps: 0,
      peakEntityCount,
      termination: "invalid-state",
      failure: "invalid-state",
    };
  }
  if (peakEntityCount > limits.maxEntities) {
    return {
      state,
      executedSteps: 0,
      peakEntityCount,
      termination: "entity-limit",
      failure: "entity-limit",
    };
  }

  let executedSteps = 0;
  let termination: CandidateSimulationTermination = budgetTermination;
  let failure: SimulationExecution["failure"] = null;
  while (executedSteps < stepBudget) {
    const previous = state;
    state = stepSimulation(
      previous,
      scriptedInput(previous, executedSteps),
      limits.stepSeconds,
      project,
    );
    executedSteps += 1;
    peakEntityCount = Math.max(peakEntityCount, entityCount(state));

    if (
      !isSimulationStateValid(state, project) ||
      state.elapsedSeconds + TIME_EPSILON_SECONDS < previous.elapsedSeconds ||
      state.tick < previous.tick ||
      state.shotsFired < previous.shotsFired ||
      state.enemiesDefeated < previous.enemiesDefeated
    ) {
      termination = "invalid-state";
      failure = "invalid-state";
      break;
    }
    if (peakEntityCount > limits.maxEntities) {
      termination = "entity-limit";
      failure = "entity-limit";
      break;
    }
    if (state.status !== "playing") {
      termination = "terminal-state";
      break;
    }
  }

  if (
    executedSteps > limits.maxSteps ||
    state.elapsedSeconds > limits.maxElapsedSeconds + TIME_EPSILON_SECONDS
  ) {
    termination = "invalid-state";
    failure = "invalid-state";
  }

  return { state, executedSteps, peakEntityCount, termination, failure };
}

function scriptedInput(
  state: SimulationState,
  stepIndex: number,
): SimulationInput {
  const movement =
    MOVEMENT_PHASES[Math.floor(stepIndex / 45) % MOVEMENT_PHASES.length] ??
    MOVEMENT_PHASES[0];
  const target = state.enemies[0];
  return {
    moveX: movement.moveX,
    moveY: movement.moveY,
    shootX: target === undefined ? 0 : target.x - state.player.x,
    shootY: target === undefined ? 0 : target.y - state.player.y,
  };
}

function isSimulationStateValid(
  state: SimulationState,
  project: GameProject,
): boolean {
  const entityIds = [
    ...state.enemies.map((entity) => entity.id),
    ...state.projectiles.map((entity) => entity.id),
    ...state.pickups.map((entity) => entity.id),
  ];
  const numericValues = [
    state.elapsedSeconds,
    state.tick,
    state.rngState,
    state.nextEntityId,
    state.shotsFired,
    state.enemiesDefeated,
    state.player.x,
    state.player.y,
    state.player.health,
    state.player.fireCooldownRemaining,
    state.player.invulnerabilityRemaining,
    ...state.enemies.flatMap((enemy) => [enemy.id, enemy.x, enemy.y, enemy.health]),
    ...state.projectiles.flatMap((projectile) => [
      projectile.id,
      projectile.x,
      projectile.y,
      projectile.velocityX,
      projectile.velocityY,
      projectile.ageSeconds,
    ]),
    ...state.pickups.flatMap((pickup) => [pickup.id, pickup.x, pickup.y]),
  ];
  const maximumEntityId = entityIds.length === 0 ? 0 : Math.max(...entityIds);

  return (
    numericValues.every(Number.isFinite) &&
    state.elapsedSeconds >= 0 &&
    state.tick >= 0 &&
    state.player.health >= 0 &&
    state.player.health <= project.player.maxHealth &&
    entityIds.every((id) => Number.isInteger(id) && id > 0) &&
    new Set(entityIds).size === entityIds.length &&
    state.nextEntityId > maximumEntityId &&
    !(state.status === "game-over" && state.player.health > 0) &&
    !(state.status === "cleared" && state.enemies.length > 0)
  );
}

function simulationsMatch(
  first: SimulationExecution,
  second: SimulationExecution,
): boolean {
  return (
    first.executedSteps === second.executedSteps &&
    first.peakEntityCount === second.peakEntityCount &&
    first.termination === second.termination &&
    first.failure === second.failure &&
    JSON.stringify(first.state) === JSON.stringify(second.state)
  );
}

function entityCount(state: SimulationState): number {
  return (
    1 + state.enemies.length + state.projectiles.length + state.pickups.length
  );
}

function appendPrimitiveDiff(
  entries: CandidateSandboxDiffEntry[],
  operationId: string,
  path: string,
  before: CandidateSandboxDiffValue,
  after: CandidateSandboxDiffValue,
): void {
  if (before === after) return;
  entries.push({ operationId, path, before, after });
}

function definedProperties(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  );
}

function buildDiff(
  entries: readonly CandidateSandboxDiffEntry[],
): CandidateSandboxDiff {
  const changedFieldCount = entries.length;
  return {
    changedFieldCount,
    summary:
      changedFieldCount === 0
        ? "Nenhum campo do projeto foi alterado."
        : `${changedFieldCount} campo(s) alterado(s): ${entries.map((entry) => entry.path).join(", ")}.`,
    entries: [...entries],
  };
}

function summarizeBehavior(
  behavior: GameProject["enemy"]["behavior"],
): string | null {
  if (behavior === undefined) return null;
  const transitionCount = behavior.states.reduce(
    (total, state) => total + state.transitions.length,
    0,
  );
  return `enemy-behavior v1; entrada ${behavior.entryStateId}; ${behavior.states.length} estado(s); ${transitionCount} transição(ões); fp ${fingerprint(JSON.stringify(behavior))}`;
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isAssetOperation(operation: ChangeOperation): operation is AssetOperation {
  return (
    operation.kind === "asset.add" ||
    operation.kind === "asset.replace" ||
    operation.kind === "asset.remove"
  );
}

function describeUnavailableAssets(
  operations: readonly AssetOperation[],
): string {
  const references = operations.map((operation) => {
    if (operation.kind === "asset.remove") {
      return `${operation.operationId} (${operation.slot}; asset ${operation.assetId} sem identidade persistida no GameProject)`;
    }
    return `${operation.operationId} (${operation.slot}; objeto ${operation.asset.storageObjectId} sem bytes PNG)`;
  });
  return truncateDetails(
    `Nenhuma alteração de asset foi simulada. O contrato contém descritores, mas o motor não recebeu conteúdo binário verificável: ${references.join(", ")}.`,
  );
}

function summarizeIssues(error: {
  readonly issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly message: string;
  }[];
}): string {
  const details = error.issues
    .slice(0, 8)
    .map((issue) => {
      const path =
        issue.path.length === 0
          ? "$"
          : issue.path.map((segment) => String(segment)).join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return truncateDetails(details || "Entrada inválida sem detalhes adicionais.");
}

function makeCheck(
  checkId: string,
  name: string,
  status: CandidateSandboxCheck["status"],
  details: string | null,
): CandidateSandboxCheck {
  return {
    checkId,
    name,
    status,
    details: details === null ? null : truncateDetails(details),
  };
}

function truncateDetails(value: string): string {
  return value.length <= 2_000 ? value : `${value.slice(0, 1_997)}...`;
}

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function resultFrom(
  status: CandidateSandboxResult["status"],
  candidate: GameProject | null,
  checks: readonly CandidateSandboxCheck[],
  diff: CandidateSandboxDiff,
  simulation: CandidateSimulationSummary | null,
): CandidateSandboxResult {
  return {
    status,
    candidate,
    checks: [...checks],
    diff,
    simulation,
  };
}

function failedResult(
  checks: readonly CandidateSandboxCheck[],
  diff: CandidateSandboxDiff = buildDiff([]),
): CandidateSandboxResult {
  return resultFrom("failed", null, checks, diff, null);
}
