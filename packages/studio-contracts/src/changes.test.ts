import { describe, expect, it } from "vitest";
import {
  ApprovalRecordSchema,
  canTransitionChangeSet,
  ChangeProposalSchema,
  ChangeSetSchema,
  PublicationRecordSchema,
  SandboxTestRecordSchema,
} from "./changes.js";
import {
  APPROVED_CHANGE_SET,
  BASE_REVISION,
  BEHAVIOR_OPERATION,
  CANDIDATE_REVISION,
  EDITOR,
  LATER,
  LATEST,
  NOW,
  OWNER,
  OWNER_APPROVAL,
  PASSING_TEST,
  PENDING_PUBLICATION,
  PROVIDER,
  REVIEWER,
  SUCCESSFUL_PUBLICATION,
} from "./test-fixtures.js";

const USER_PROPOSAL = {
  schemaVersion: 1,
  proposalId: "proposal-001",
  workspaceId: "workspace-main",
  projectId: "project-main",
  baseRevision: BASE_REVISION,
  title: "Nova movimentação do sentinela",
  explanation: "Combina patrulha, perseguição e fuga em estados seguros.",
  author: EDITOR,
  operations: [BEHAVIOR_OPERATION],
  status: "pending",
  resolution: null,
  createdAt: NOW,
} as const;

describe("change proposals", () => {
  it("accepts human and provider-neutral AI proposals", () => {
    expect(ChangeProposalSchema.parse(USER_PROPOSAL)).toEqual(USER_PROPOSAL);

    const aiProposal = {
      ...USER_PROPOSAL,
      proposalId: "proposal-ai-001",
      author: {
        kind: "assistant",
        assistantId: "assistant-main",
        displayName: "Assistente do estúdio",
        mode: "propose-behavior",
        provider: PROVIDER,
      },
    } as const;
    expect(ChangeProposalSchema.safeParse(aiProposal).success).toBe(true);
  });

  it("does not let chat-only AI modes create proposals", () => {
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        author: {
          kind: "assistant",
          assistantId: "assistant-main",
          displayName: "Assistente",
          mode: "chat",
          provider: PROVIDER,
        },
      }).success,
    ).toBe(false);
  });

  it("requires behavior and image modes to emit matching domain commands", () => {
    const tuningOperation = {
      operationId: "operation-tuning",
      kind: "enemy.set-tuning",
      explanation: "Ajusta a velocidade.",
      tuning: { speed: 120 },
    } as const;
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        operations: [tuningOperation],
        author: {
          kind: "assistant",
          assistantId: "assistant-main",
          displayName: "Assistente",
          mode: "propose-behavior",
          provider: PROVIDER,
        },
      }).success,
    ).toBe(false);
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        operations: [tuningOperation],
        author: {
          kind: "assistant",
          assistantId: "assistant-main",
          displayName: "Assistente",
          mode: "clean-png",
          provider: PROVIDER,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps status and resolution metadata consistent", () => {
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        status: "accepted",
        resolution: null,
      }).success,
    ).toBe(false);
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        status: "accepted",
        resolution: {
          kind: "accepted",
          resolvedAt: LATER,
          resolvedByUserId: OWNER.userId,
          changeSetId: "change-set-001",
        },
      }).success,
    ).toBe(true);
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        status: "rejected",
        resolution: {
          kind: "accepted",
          resolvedAt: LATER,
          resolvedByUserId: OWNER.userId,
          changeSetId: "change-set-001",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects proposals against another project and unknown fields", () => {
    expect(
      ChangeProposalSchema.safeParse({
        ...USER_PROPOSAL,
        projectId: "project-other",
      }).success,
    ).toBe(false);
    expect(
      ChangeProposalSchema.safeParse({ ...USER_PROPOSAL, apiKey: "no" }).success,
    ).toBe(false);
  });
});

describe("sandbox testing and approvals", () => {
  it("accepts internally consistent passing tests", () => {
    expect(SandboxTestRecordSchema.parse(PASSING_TEST)).toEqual(PASSING_TEST);
  });

  it("does not label failed checks as a passing run", () => {
    expect(
      SandboxTestRecordSchema.safeParse({
        ...PASSING_TEST,
        checks: [{ ...PASSING_TEST.checks[0], status: "failed" }],
      }).success,
    ).toBe(false);
  });

  it("rejects viewer tests and inverted timestamps", () => {
    expect(
      SandboxTestRecordSchema.safeParse({
        ...PASSING_TEST,
        executedBy: { ...REVIEWER, role: "viewer" },
      }).success,
    ).toBe(false);
    expect(
      SandboxTestRecordSchema.safeParse({
        ...PASSING_TEST,
        startedAt: LATEST,
        completedAt: LATER,
      }).success,
    ).toBe(false);
  });

  it("reserves approval for the owner while reviewers can request changes", () => {
    expect(ApprovalRecordSchema.parse(OWNER_APPROVAL)).toEqual(OWNER_APPROVAL);
    expect(
      ApprovalRecordSchema.safeParse({
        ...OWNER_APPROVAL,
        decidedBy: REVIEWER,
      }).success,
    ).toBe(false);
    expect(
      ApprovalRecordSchema.safeParse({
        ...OWNER_APPROVAL,
        decision: "request-changes",
        decidedBy: REVIEWER,
      }).success,
    ).toBe(true);
  });
});

describe("change set state machine", () => {
  it("accepts an empty draft and a tested owner-approved candidate", () => {
    const draft = {
      ...APPROVED_CHANGE_SET,
      status: "draft",
      candidateRevision: null,
      sourceProposalIds: [],
      operations: [],
      latestTest: null,
      review: null,
      updatedAt: NOW,
    } as const;
    expect(ChangeSetSchema.safeParse(draft).success).toBe(true);
    expect(ChangeSetSchema.parse(APPROVED_CHANGE_SET)).toEqual(
      APPROVED_CHANGE_SET,
    );
  });

  it("requires a candidate and operations outside draft", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "proposed",
        candidateRevision: null,
        operations: [],
        latestTest: null,
        review: null,
      }).success,
    ).toBe(false);
  });

  it("requires candidate ancestry, sequence and a changed digest", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        candidateRevision: {
          ...CANDIDATE_REVISION,
          parentRevisionId: "revision-other",
        },
      }).success,
    ).toBe(false);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        candidateRevision: {
          ...CANDIDATE_REVISION,
          digest: BASE_REVISION.digest,
        },
        latestTest: {
          ...PASSING_TEST,
          revisionDigest: BASE_REVISION.digest,
        },
      }).success,
    ).toBe(false);
  });

  it("binds sandbox evidence to the exact candidate digest", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        latestTest: {
          ...PASSING_TEST,
          revisionDigest: "f".repeat(64),
        },
      }).success,
    ).toBe(false);
  });

  it("binds every review to the exact candidate ID and digest", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        review: { ...OWNER_APPROVAL, revisionId: "revision-other" },
      }).success,
    ).toBe(false);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        review: { ...OWNER_APPROVAL, revisionDigest: "f".repeat(64) },
      }).success,
    ).toBe(false);

    const replacementCandidate = {
      ...CANDIDATE_REVISION,
      revisionId: "revision-002",
      digest: "c".repeat(64),
    };
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        candidateRevision: replacementCandidate,
        latestTest: {
          ...PASSING_TEST,
          testRunId: "test-run-002",
          revisionId: replacementCandidate.revisionId,
          revisionDigest: replacementCandidate.digest,
        },
      }).success,
    ).toBe(false);
  });

  it("will not approve without a passing test and a later owner decision", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        latestTest: { ...PASSING_TEST, status: "failed" },
      }).success,
    ).toBe(false);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        review: { ...OWNER_APPROVAL, decidedAt: NOW },
      }).success,
    ).toBe(false);
  });

  it("requires review decisions to agree with rejected states", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "rejected",
        latestTest: null,
        review: {
          decision: "reject",
          revisionId: CANDIDATE_REVISION.revisionId,
          revisionDigest: CANDIDATE_REVISION.digest,
          decidedBy: REVIEWER,
          explanation: "O comportamento ainda trava no canto.",
          decidedAt: LATEST,
        },
      }).success,
    ).toBe(true);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "rejected",
      }).success,
    ).toBe(false);
  });

  it("requires publication state to match change set state", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "publishing",
        publication: PENDING_PUBLICATION,
      }).success,
    ).toBe(true);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "published",
        publication: SUCCESSFUL_PUBLICATION,
      }).success,
    ).toBe(true);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "published",
        publication: PENDING_PUBLICATION,
      }).success,
    ).toBe(false);
  });

  it("requires superseded change sets to name a different replacement", () => {
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "superseded",
        supersededByChangeSetId: "change-set-002",
      }).success,
    ).toBe(true);
    expect(
      ChangeSetSchema.safeParse({
        ...APPROVED_CHANGE_SET,
        status: "superseded",
        supersededByChangeSetId: APPROVED_CHANGE_SET.changeSetId,
      }).success,
    ).toBe(false);
  });

  it("exposes only the deliberate lifecycle transitions", () => {
    expect(canTransitionChangeSet("draft", "proposed")).toBe(true);
    expect(canTransitionChangeSet("testing", "approved")).toBe(true);
    expect(canTransitionChangeSet("approved", "published")).toBe(false);
    expect(canTransitionChangeSet("published", "draft")).toBe(false);
    expect(canTransitionChangeSet("draft", "draft")).toBe(false);
  });
});

describe("publication metadata", () => {
  it("validates pending and successful attempts", () => {
    expect(PublicationRecordSchema.safeParse(PENDING_PUBLICATION).success).toBe(
      true,
    );
    expect(
      PublicationRecordSchema.safeParse(SUCCESSFUL_PUBLICATION).success,
    ).toBe(true);
  });

  it("requires completion metadata and paired change-request references", () => {
    expect(
      PublicationRecordSchema.safeParse({
        ...SUCCESSFUL_PUBLICATION,
        commitDigest: null,
      }).success,
    ).toBe(false);
    expect(
      PublicationRecordSchema.safeParse({
        ...PENDING_PUBLICATION,
        changeRequestUrl: null,
      }).success,
    ).toBe(false);
  });
});
