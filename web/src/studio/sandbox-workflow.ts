import type { SandboxCheck } from "@collaborative-roguelike/studio-contracts";

import type { GameProject } from "../core";
import type {
  StudioBackendRole,
  StudioChangeSetDto,
  StudioSandboxTestInput,
} from "./api-client";
import {
  runCandidateSandbox,
  type CandidateSandboxResult,
} from "./candidate-sandbox";
import type { StudioSandboxModel } from "./model";

export interface StudioCandidateEvaluation {
  readonly result: CandidateSandboxResult | null;
  readonly previewProject: GameProject | null;
  readonly baseRevisionIsCurrent: boolean;
  readonly canRecordTest: boolean;
  readonly model: StudioSandboxModel;
}

interface EvaluateStudioCandidateInput {
  readonly publishedProject: GameProject;
  readonly publishedRevisionNumber: number;
  readonly changeSet: StudioChangeSetDto | null;
  readonly userRole: StudioBackendRole;
  readonly testInFlight: boolean;
}

/**
 * Joins the browser sandbox result to the server revision state. The backend
 * digest remains authoritative; this function never invents approval identity.
 */
export function evaluateStudioCandidate(
  input: EvaluateStudioCandidateInput,
): StudioCandidateEvaluation {
  const candidateRevision = input.changeSet?.candidateRevision ?? null;
  if (!input.changeSet || !candidateRevision) {
    return unavailableEvaluation(
      "Selecione uma proposta com revisão candidata para preparar o jogo.",
    );
  }

  const baseRevisionIsCurrent =
    input.changeSet.baseRevision.sequence + 1 === input.publishedRevisionNumber;
  if (!baseRevisionIsCurrent) {
    const check = revisionCheck(
      "failed",
      `A proposta usa a revisão ${input.changeSet.baseRevision.sequence + 1}, mas o projeto está na revisão ${input.publishedRevisionNumber}.`,
    );
    return {
      result: null,
      previewProject: null,
      baseRevisionIsCurrent: false,
      canRecordTest: false,
      model: {
        previewState: "failed",
        statusMessage:
          "A candidata ficou desatualizada e precisa ser recriada sobre o projeto atual.",
        canRunTest: false,
        checklist: [checklistItem(check)],
      },
    };
  }

  const result = runCandidateSandbox(
    input.publishedProject,
    input.changeSet.operations,
  );
  const checks = [
    revisionCheck(
      "passed",
      `A proposta parte da revisão publicada ${input.publishedRevisionNumber}.`,
    ),
    ...result.checks,
  ];
  const statusAllowsTesting = ["draft", "proposed", "testing"].includes(
    input.changeSet.status,
  );
  const roleCanStartDraft =
    input.changeSet.status !== "draft" ||
    input.userRole === "owner" ||
    input.userRole === "editor";
  const roleCanRecord = input.userRole !== "viewer";
  const canRecordTest =
    statusAllowsTesting && roleCanStartDraft && roleCanRecord && !input.testInFlight;

  return {
    result: { ...result, checks },
    previewProject: result.candidate,
    baseRevisionIsCurrent: true,
    canRecordTest,
    model: {
      previewState: input.testInFlight
        ? "testing"
        : result.status === "passed"
          ? "ready"
          : "failed",
      statusMessage: input.testInFlight
        ? "Registrando o teste para o ID e o digest exatos desta candidata."
        : result.status === "passed"
          ? "Candidata validada e pronta para ser jogada antes do registro do teste."
          : "A candidata falhou nas verificações; registre a falha ou ajuste a proposta.",
      canRunTest: canRecordTest,
      checklist: checks.map(checklistItem),
    },
  };
}

/** Creates immutable evidence for the exact revision supplied by the server. */
export function createSandboxTestInput(
  evaluation: StudioCandidateEvaluation,
  changeSet: StudioChangeSetDto,
  startedAt: string,
  completedAt: string,
): StudioSandboxTestInput | null {
  const revision = changeSet.candidateRevision;
  const result = evaluation.result;
  if (
    !revision ||
    !evaluation.baseRevisionIsCurrent ||
    !result ||
    !evaluation.canRecordTest
  ) {
    return null;
  }

  const manualPreviewCheck: SandboxCheck | null =
    result.status === "passed" && evaluation.previewProject
      ? {
          checkId: "candidate-playable-preview",
          name: "A pessoa confirmou a prévia jogável desta candidata",
          status: "passed",
          details:
            "O registro foi solicitado pela ação explícita no Sandbox após a prévia atual/candidata ficar disponível.",
        }
      : null;
  const checks = manualPreviewCheck
    ? [...result.checks, manualPreviewCheck]
    : [...result.checks];

  return {
    revisionId: revision.revisionId,
    revisionDigest: revision.digest,
    status: result.status,
    checks,
    startedAt,
    completedAt,
  };
}

function unavailableEvaluation(statusMessage: string): StudioCandidateEvaluation {
  return {
    result: null,
    previewProject: null,
    baseRevisionIsCurrent: false,
    canRecordTest: false,
    model: {
      previewState: "preparing",
      statusMessage,
      canRunTest: false,
      checklist: [],
    },
  };
}

function revisionCheck(
  status: SandboxCheck["status"],
  details: string,
): SandboxCheck {
  return {
    checkId: "candidate-base-revision",
    name: "A revisão base ainda é a versão publicada atual",
    status,
    details,
  };
}

function checklistItem(check: SandboxCheck) {
  return {
    id: check.checkId,
    label: check.name,
    ...(check.details === null ? {} : { detail: check.details }),
    status: check.status,
  } as const;
}
