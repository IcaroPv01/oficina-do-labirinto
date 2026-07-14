import { SandboxCheckSchema } from "@collaborative-roguelike/studio-contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_PROJECT } from "../core";
import { runCandidateSandbox } from "./candidate-sandbox";

const SIMPLE_BEHAVIOR = {
  schemaVersion: 1,
  kind: "enemy-behavior",
  entryStateId: "guard",
  states: [
    {
      stateId: "guard",
      movement: { kind: "idle", facePlayer: true },
      transitions: [],
    },
  ],
} as const;

const COMPLETE_OPERATION_SET = [
  {
    operationId: "operation-name",
    kind: "project.set-name",
    explanation: "Identifica claramente o candidato em teste.",
    name: "Expedição Candidata",
  },
  {
    operationId: "operation-seed",
    kind: "project.set-seed",
    explanation: "Fixa uma seed específica para o candidato.",
    seed: "candidate-seed-v1",
  },
  {
    operationId: "operation-player",
    kind: "player.set-tuning",
    explanation: "Ajusta cor e velocidade do jogador.",
    tuning: { color: "#123456", speed: 260 },
  },
  {
    operationId: "operation-enemy",
    kind: "enemy.set-tuning",
    explanation: "Ajusta identidade e parâmetros do inimigo.",
    tuning: { name: "Guardião", speed: 48, spawnCount: 2 },
  },
  {
    operationId: "operation-behavior",
    kind: "enemy.set-behavior",
    explanation: "Adiciona comportamento declarativo validado.",
    behavior: SIMPLE_BEHAVIOR,
  },
  {
    operationId: "operation-world",
    kind: "world.set-style",
    explanation: "Ajusta dimensões e cor de fundo da arena.",
    style: { width: 1_024, backgroundColor: "#202938" },
  },
  {
    operationId: "operation-run",
    kind: "run.set-settings",
    explanation: "Ajusta a configuração da expedição.",
    settings: { endless: true, roomsPerFloor: 5 },
  },
] as const;

const SMOKE_OPERATION_SET = [
  {
    operationId: "operation-smoke-name",
    kind: "project.set-name",
    explanation: "Cria uma mudança efetiva mínima para o smoke test.",
    name: "Candidato Smoke",
  },
] as const;

describe("motor candidato do sandbox", () => {
  it("clona o projeto e aplica todas as operações suportadas sem mutar entradas", () => {
    const baseSnapshot = structuredClone(DEFAULT_GAME_PROJECT);
    const operationsSnapshot = structuredClone(COMPLETE_OPERATION_SET);

    const result = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      COMPLETE_OPERATION_SET,
      { maxSteps: 90, maxElapsedSeconds: 2, maxEntities: 64 },
    );

    expect(result.status).toBe("passed");
    expect(result.candidate).not.toBeNull();
    expect(DEFAULT_GAME_PROJECT).toEqual(baseSnapshot);
    expect(COMPLETE_OPERATION_SET).toEqual(operationsSnapshot);
    expect(result.candidate).not.toBe(DEFAULT_GAME_PROJECT);
    expect(result.candidate?.name).toBe("Expedição Candidata");
    expect(result.candidate?.seed).toBe("candidate-seed-v1");
    expect(result.candidate?.player).toMatchObject({
      color: "#123456",
      speed: 260,
    });
    expect(result.candidate?.enemy).toMatchObject({
      name: "Guardião",
      speed: 48,
      spawnCount: 2,
      behavior: SIMPLE_BEHAVIOR,
    });
    expect(result.candidate?.enemy.behavior).not.toBe(SIMPLE_BEHAVIOR);
    expect(result.candidate?.world).toMatchObject({
      width: 1_024,
      backgroundColor: "#202938",
    });
    expect(result.candidate?.run).toMatchObject({
      endless: true,
      roomsPerFloor: 5,
    });
    expect(result.diff.entries.map((entry) => entry.path)).toEqual([
      "project.name",
      "project.seed",
      "player.color",
      "player.speed",
      "enemy.name",
      "enemy.speed",
      "enemy.spawnCount",
      "enemy.behavior",
      "world.width",
      "world.backgroundColor",
      "run.endless",
      "run.roomsPerFloor",
    ]);
    expect(result.diff.changedFieldCount).toBe(12);
    expect(result.checks.every((check) => SandboxCheckSchema.safeParse(check).success)).toBe(
      true,
    );
  });

  it("produz o mesmo candidato, diff, checks e resumo para entradas iguais", () => {
    const options = {
      maxSteps: 120,
      maxEntities: 64,
      maxElapsedSeconds: 3,
      stepSeconds: 1 / 60,
    } as const;

    const first = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      COMPLETE_OPERATION_SET,
      options,
    );
    const second = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      COMPLETE_OPERATION_SET,
      options,
    );

    expect(first).toEqual(second);
    expect(first.simulation?.deterministic).toBe(true);
  });

  it("torna enemy.set-behavior observável na simulação do sandbox", () => {
    const options = {
      maxSteps: 240,
      maxEntities: 64,
      maxElapsedSeconds: 4,
    } as const;
    const baseline = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      SMOKE_OPERATION_SET,
      options,
    );
    const withBehavior = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      [
        {
          operationId: "operation-observable-behavior",
          kind: "enemy.set-behavior",
          explanation: "Mantém inimigos imóveis para provar o efeito no sandbox.",
          behavior: SIMPLE_BEHAVIOR,
        },
      ],
      options,
    );

    expect(withBehavior.status).toBe("passed");
    expect(withBehavior.diff.entries).toEqual([
      expect.objectContaining({ path: "enemy.behavior" }),
    ]);
    expect(withBehavior.simulation?.deterministic).toBe(true);
    expect(withBehavior.simulation?.executedSteps).not.toBe(
      baseline.simulation?.executedSteps,
    );
  });

  it("respeita os limites de passos, tempo e entidades", () => {
    const stepLimited = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      SMOKE_OPERATION_SET,
      {
      maxSteps: 3,
      maxElapsedSeconds: 1,
      maxEntities: 64,
      },
    );

    expect(stepLimited.status).toBe("passed");
    expect(stepLimited.simulation).toMatchObject({
      executedSteps: 3,
      termination: "step-limit",
    });
    expect(stepLimited.simulation?.simulatedSeconds).toBeLessThanOrEqual(1);

    const entityLimited = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      SMOKE_OPERATION_SET,
      {
        maxSteps: 3,
        maxElapsedSeconds: 1,
        maxEntities: 1,
      },
    );

    expect(entityLimited.status).toBe("failed");
    expect(entityLimited.candidate).not.toBeNull();
    expect(entityLimited.simulation).toMatchObject({
      executedSteps: 0,
      termination: "entity-limit",
    });
    expect(
      entityLimited.checks.find(
        (check) => check.checkId === "candidate-core-simulation",
      ),
    ).toMatchObject({ status: "failed" });
  });

  it("converte operação inválida e input hostil em falhas, sem lançar", () => {
    const invalidOperation = [
      {
        operationId: "operation-invalid",
        kind: "project.execute-script",
        explanation: "Esta operação arbitrária deve ser recusada.",
        script: "while (true) {}",
      },
    ];

    expect(() =>
      runCandidateSandbox(DEFAULT_GAME_PROJECT, invalidOperation),
    ).not.toThrow();
    const invalidResult = runCandidateSandbox(
      DEFAULT_GAME_PROJECT,
      invalidOperation,
    );
    expect(invalidResult.status).toBe("failed");
    expect(invalidResult.candidate).toBeNull();
    expect(
      invalidResult.checks.find(
        (check) => check.checkId === "candidate-operations-contract",
      ),
    ).toMatchObject({ status: "failed" });

    const hostileBase = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile input");
        },
      },
    );
    expect(() => runCandidateSandbox(hostileBase, [])).not.toThrow();
    expect(runCandidateSandbox(hostileBase, [])).toMatchObject({
      status: "failed",
      candidate: null,
    });
  });

  it("bloqueia candidato sem nenhuma mudança efetiva", () => {
    const result = runCandidateSandbox(DEFAULT_GAME_PROJECT, [
      {
        operationId: "operation-no-op",
        kind: "project.set-name",
        explanation: "Repete deliberadamente o nome atual.",
        name: DEFAULT_GAME_PROJECT.name,
      },
    ]);

    expect(result).toMatchObject({
      status: "failed",
      candidate: null,
      diff: { changedFieldCount: 0 },
    });
    expect(
      result.checks.find(
        (check) => check.checkId === "candidate-effective-change",
      ),
    ).toMatchObject({ status: "failed" });
  });

  it("falha claramente quando um descritor de asset não traz bytes resolvíveis", () => {
    const assetOperation = {
      operationId: "operation-asset",
      kind: "asset.add",
      explanation: "Tenta adicionar uma skin descrita, mas sem o PNG disponível.",
      slot: "player.skin",
      asset: {
        assetId: "asset-player-skin",
        kind: "player-sprite",
        filename: "hero.png",
        mediaType: "image/png",
        bytes: 128,
        width: 32,
        height: 32,
        sha256: "a".repeat(64),
        storageObjectId: "object-player-skin",
        license: "original",
        provenance: {
          origin: "user-upload",
          createdAt: "2026-07-13T12:00:00.000Z",
          createdBy: {
            kind: "user",
            userId: "user-editor",
            displayName: "Editor",
            role: "editor",
          },
          sourceAssetIds: [],
          provider: null,
          promptDigest: null,
          transform: null,
        },
      },
    } as const;

    const result = runCandidateSandbox(DEFAULT_GAME_PROJECT, [assetOperation]);

    expect(result.status).toBe("failed");
    expect(result.candidate).toBeNull();
    expect(result.diff.changedFieldCount).toBe(0);
    expect(
      result.checks.find(
        (check) => check.checkId === "candidate-asset-content",
      ),
    ).toMatchObject({
      status: "failed",
      details: expect.stringContaining("object-player-skin"),
    });
  });
});
