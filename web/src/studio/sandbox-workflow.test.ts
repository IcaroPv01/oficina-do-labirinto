import { describe, expect, it } from "vitest";

import { DEFAULT_GAME_PROJECT } from "../core";
import type { StudioChangeSetDto } from "./api-client";
import {
  createSandboxTestInput,
  evaluateStudioCandidate,
} from "./sandbox-workflow";
import { studioDraftChangeSet } from "./studio-test-fixtures";

function candidateChangeSet(
  overrides: Partial<StudioChangeSetDto> = {},
): StudioChangeSetDto {
  const draft = studioDraftChangeSet();
  const changeSet: StudioChangeSetDto = {
    ...draft,
    status: "proposed",
    baseRevision: { ...draft.baseRevision, sequence: 0 },
    candidateRevision: {
      ...draft.baseRevision,
      revisionId: "candidate-workflow-1",
      parentRevisionId: draft.baseRevision.revisionId,
      sequence: 1,
      digest: "e".repeat(64),
    },
    operations: [
      {
        operationId: "operation-workflow-speed",
        kind: "player.set-tuning",
        explanation: "Aumenta a velocidade para o teste jogável.",
        tuning: { speed: 280 },
      },
    ],
    ...overrides,
    sourceProposalIds: [
      ...(overrides.sourceProposalIds ?? draft.sourceProposalIds),
    ],
  };
  return changeSet;
}

describe("studio sandbox workflow", () => {
  it("prepara a candidata atual e cria evidência ligada ao digest do servidor", () => {
    const changeSet = candidateChangeSet();
    const evaluation = evaluateStudioCandidate({
      publishedProject: DEFAULT_GAME_PROJECT,
      publishedRevisionNumber: 1,
      changeSet,
      userRole: "owner",
      testInFlight: false,
    });
    const evidence = createSandboxTestInput(
      evaluation,
      changeSet,
      "2026-07-13T12:01:00.000Z",
      "2026-07-13T12:01:01.000Z",
    );

    expect(evaluation.model.previewState).toBe("ready");
    expect(evaluation.previewProject?.player.speed).toBe(280);
    expect(evidence).toMatchObject({
      revisionId: changeSet.candidateRevision?.revisionId,
      revisionDigest: changeSet.candidateRevision?.digest,
      status: "passed",
    });
    expect(evidence?.checks.some(({ checkId }) => checkId === "candidate-playable-preview"))
      .toBe(true);
  });

  it("bloqueia teste quando outra pessoa avançou o projeto base", () => {
    const changeSet = candidateChangeSet();
    const evaluation = evaluateStudioCandidate({
      publishedProject: DEFAULT_GAME_PROJECT,
      publishedRevisionNumber: 2,
      changeSet,
      userRole: "owner",
      testInFlight: false,
    });

    expect(evaluation.model.previewState).toBe("failed");
    expect(evaluation.canRecordTest).toBe(false);
    expect(
      createSandboxTestInput(
        evaluation,
        changeSet,
        "2026-07-13T12:01:00.000Z",
        "2026-07-13T12:01:01.000Z",
      ),
    ).toBeNull();
  });

  it("permite registrar falha determinística sem liberar uma prévia inválida", () => {
    const changeSet = candidateChangeSet({
      operations: [
        {
          operationId: "operation-no-op-workflow",
          kind: "project.set-name",
          explanation: "Repete o nome para provar que no-op é bloqueado.",
          name: DEFAULT_GAME_PROJECT.name,
        },
      ],
    });
    const evaluation = evaluateStudioCandidate({
      publishedProject: DEFAULT_GAME_PROJECT,
      publishedRevisionNumber: 1,
      changeSet,
      userRole: "owner",
      testInFlight: false,
    });
    const evidence = createSandboxTestInput(
      evaluation,
      changeSet,
      "2026-07-13T12:01:00.000Z",
      "2026-07-13T12:01:01.000Z",
    );

    expect(evaluation.previewProject).toBeNull();
    expect(evidence?.status).toBe("failed");
    expect(evidence?.checks.some(({ status }) => status === "failed")).toBe(true);
  });
});
