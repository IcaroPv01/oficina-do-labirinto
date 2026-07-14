import { z } from "zod";
import { ChangeOperationsSchema } from "./operations.js";
import {
  AiModeSchema,
  DisplayNameSchema,
  ExplanationSchema,
  IsoDateTimeSchema,
  ProviderMetadataSchema,
  RevisionDigestMetadataSchema,
  Sha256Schema,
  StudioIdSchema,
  UserActorSchema,
} from "./primitives.js";

export const ProposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "expired",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

const UserProposalAuthorSchema = z
  .object({
    kind: z.literal("user"),
    userId: StudioIdSchema,
    displayName: DisplayNameSchema,
    role: z.enum(["owner", "editor"]),
  })
  .strict();

const AssistantProposalAuthorSchema = z
  .object({
    kind: z.literal("assistant"),
    assistantId: StudioIdSchema,
    displayName: DisplayNameSchema,
    mode: AiModeSchema,
    provider: ProviderMetadataSchema,
  })
  .strict();

export const ProposalAuthorSchema = z.discriminatedUnion("kind", [
  UserProposalAuthorSchema,
  AssistantProposalAuthorSchema,
]);
export type ProposalAuthor = z.infer<typeof ProposalAuthorSchema>;

const AcceptedProposalResolutionSchema = z
  .object({
    kind: z.literal("accepted"),
    resolvedAt: IsoDateTimeSchema,
    resolvedByUserId: StudioIdSchema,
    changeSetId: StudioIdSchema,
  })
  .strict();

const RejectedProposalResolutionSchema = z
  .object({
    kind: z.literal("rejected"),
    resolvedAt: IsoDateTimeSchema,
    resolvedByUserId: StudioIdSchema,
    explanation: ExplanationSchema,
  })
  .strict();

const ExpiredProposalResolutionSchema = z
  .object({
    kind: z.literal("expired"),
    resolvedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProposalResolutionSchema = z.discriminatedUnion("kind", [
  AcceptedProposalResolutionSchema,
  RejectedProposalResolutionSchema,
  ExpiredProposalResolutionSchema,
]);
export type ProposalResolution = z.infer<typeof ProposalResolutionSchema>;

export const ChangeProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    proposalId: StudioIdSchema,
    workspaceId: StudioIdSchema,
    projectId: StudioIdSchema,
    baseRevision: RevisionDigestMetadataSchema,
    title: z.string().trim().min(1).max(120),
    explanation: ExplanationSchema,
    author: ProposalAuthorSchema,
    operations: ChangeOperationsSchema.min(1),
    status: ProposalStatusSchema,
    resolution: ProposalResolutionSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.baseRevision.projectId !== proposal.projectId) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision", "projectId"],
        message: "The base revision must belong to the proposal project.",
      });
    }

    if (proposal.author.kind === "assistant") {
      if (proposal.author.mode === "chat" || proposal.author.mode === "explain") {
        context.addIssue({
          code: "custom",
          path: ["author", "mode"],
          message: "Chat-only AI modes cannot author change proposals.",
        });
      }

      const hasBehavior = proposal.operations.some(
        (operation) => operation.kind === "enemy.set-behavior",
      );
      const hasAsset = proposal.operations.some((operation) =>
        operation.kind.startsWith("asset."),
      );
      if (proposal.author.mode === "propose-behavior" && !hasBehavior) {
        context.addIssue({
          code: "custom",
          path: ["operations"],
          message: "Behavior proposals must contain an enemy behavior command.",
        });
      }
      if (
        ["generate-sprite", "edit-sprite", "clean-png"].includes(
          proposal.author.mode,
        ) &&
        !hasAsset
      ) {
        context.addIssue({
          code: "custom",
          path: ["operations"],
          message: "Image proposals must contain an asset command.",
        });
      }
    }

    if (proposal.status === "pending" && proposal.resolution !== null) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "A pending proposal cannot have a resolution.",
      });
    }
    if (proposal.status !== "pending" && proposal.resolution === null) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "A resolved proposal requires resolution metadata.",
      });
    }
    if (
      proposal.status !== "pending" &&
      proposal.resolution !== null &&
      proposal.resolution.kind !== proposal.status
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "kind"],
        message: "Proposal status and resolution must agree.",
      });
    }

    if (
      proposal.resolution !== null &&
      Date.parse(proposal.resolution.resolvedAt) < Date.parse(proposal.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "resolvedAt"],
        message: "A proposal cannot be resolved before it is created.",
      });
    }
  });
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const ChangeSetStatusSchema = z.enum([
  "draft",
  "proposed",
  "testing",
  "changes-requested",
  "approved",
  "rejected",
  "publishing",
  "published",
  "publish-failed",
  "superseded",
]);
export type ChangeSetStatus = z.infer<typeof ChangeSetStatusSchema>;

const CHANGE_SET_TRANSITIONS = {
  draft: ["proposed", "superseded"],
  proposed: ["draft", "testing", "rejected", "superseded"],
  testing: [
    "proposed",
    "changes-requested",
    "approved",
    "rejected",
    "superseded",
  ],
  "changes-requested": ["draft", "superseded"],
  approved: ["publishing", "changes-requested", "superseded"],
  rejected: [],
  publishing: ["published", "publish-failed"],
  published: [],
  "publish-failed": ["publishing", "changes-requested", "superseded"],
  superseded: [],
} as const satisfies Record<ChangeSetStatus, readonly ChangeSetStatus[]>;

export function canTransitionChangeSet(
  from: ChangeSetStatus,
  to: ChangeSetStatus,
): boolean {
  return (CHANGE_SET_TRANSITIONS[from] as readonly ChangeSetStatus[]).includes(to);
}

export const SandboxCheckSchema = z
  .object({
    checkId: StudioIdSchema,
    name: z.string().trim().min(1).max(120),
    status: z.enum(["passed", "failed"]),
    details: z.string().trim().max(2_000).nullable(),
  })
  .strict();
export type SandboxCheck = z.infer<typeof SandboxCheckSchema>;

export const SandboxTestRecordSchema = z
  .object({
    testRunId: StudioIdSchema,
    revisionId: StudioIdSchema,
    revisionDigest: Sha256Schema,
    status: z.enum(["passed", "failed"]),
    checks: z.array(SandboxCheckSchema).min(1).max(64),
    executedBy: UserActorSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((test, context) => {
    if (test.executedBy.role === "viewer") {
      context.addIssue({
        code: "custom",
        path: ["executedBy", "role"],
        message: "Viewers cannot record sandbox tests.",
      });
    }
    if (new Set(test.checks.map((check) => check.checkId)).size !== test.checks.length) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Sandbox check IDs must be unique.",
      });
    }
    const hasFailure = test.checks.some((check) => check.status === "failed");
    if (test.status === "passed" && hasFailure) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A passing test cannot contain failed checks.",
      });
    }
    if (test.status === "failed" && !hasFailure) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A failed test must contain at least one failed check.",
      });
    }
    if (Date.parse(test.completedAt) < Date.parse(test.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A sandbox test cannot finish before it starts.",
      });
    }
  });
export type SandboxTestRecord = z.infer<typeof SandboxTestRecordSchema>;

export const ApprovalRecordSchema = z
  .object({
    decision: z.enum(["approve", "request-changes", "reject"]),
    revisionId: StudioIdSchema,
    revisionDigest: Sha256Schema,
    decidedBy: UserActorSchema,
    explanation: ExplanationSchema,
    decidedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    if (approval.decision === "approve" && approval.decidedBy.role !== "owner") {
      context.addIssue({
        code: "custom",
        path: ["decidedBy", "role"],
        message: "Only an owner can approve a change set.",
      });
    }
    if (
      approval.decision !== "approve" &&
      approval.decidedBy.role !== "owner" &&
      approval.decidedBy.role !== "reviewer"
    ) {
      context.addIssue({
        code: "custom",
        path: ["decidedBy", "role"],
        message: "Only owners and reviewers can review a change set.",
      });
    }
  });
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const PublicationRecordSchema = z
  .object({
    publicationId: StudioIdSchema,
    status: z.enum(["pending", "succeeded", "failed"]),
    scmProvider: z.string().trim().min(1).max(80),
    repository: z.string().trim().min(1).max(240),
    branch: z.string().min(1).max(240).regex(/^[^\s~^:?*[\\]+$/),
    changeRequestId: z.string().min(1).max(120).nullable(),
    changeRequestUrl: z.string().url().startsWith("https://").nullable(),
    commitDigest: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    failureReason: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine((publication, context) => {
    if (publication.status === "pending") {
      if (publication.completedAt !== null || publication.failureReason !== null) {
        context.addIssue({
          code: "custom",
          message: "A pending publication cannot be completed or failed.",
        });
      }
    }
    if (publication.status === "succeeded") {
      if (publication.completedAt === null || publication.commitDigest === null) {
        context.addIssue({
          code: "custom",
          message: "A successful publication requires completion and commit metadata.",
        });
      }
      if (publication.failureReason !== null) {
        context.addIssue({
          code: "custom",
          path: ["failureReason"],
          message: "A successful publication cannot have a failure reason.",
        });
      }
    }
    if (publication.status === "failed") {
      if (publication.completedAt === null || publication.failureReason === null) {
        context.addIssue({
          code: "custom",
          message: "A failed publication requires completion and a reason.",
        });
      }
    }
    if (
      publication.completedAt !== null &&
      Date.parse(publication.completedAt) < Date.parse(publication.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A publication cannot complete before it starts.",
      });
    }
    if (
      (publication.changeRequestId === null) !==
      (publication.changeRequestUrl === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["changeRequestUrl"],
        message: "Change request ID and URL must be provided together.",
      });
    }
  });
export type PublicationRecord = z.infer<typeof PublicationRecordSchema>;

function addRequiredIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

export const ChangeSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    changeSetId: StudioIdSchema,
    workspaceId: StudioIdSchema,
    projectId: StudioIdSchema,
    title: z.string().trim().min(1).max(120),
    explanation: ExplanationSchema,
    status: ChangeSetStatusSchema,
    baseRevision: RevisionDigestMetadataSchema,
    candidateRevision: RevisionDigestMetadataSchema.nullable(),
    sourceProposalIds: z.array(StudioIdSchema).max(16),
    operations: ChangeOperationsSchema,
    author: UserActorSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    latestTest: SandboxTestRecordSchema.nullable(),
    review: ApprovalRecordSchema.nullable(),
    publication: PublicationRecordSchema.nullable(),
    supersededByChangeSetId: StudioIdSchema.nullable(),
  })
  .strict()
  .superRefine((changeSet, context) => {
    if (changeSet.author.role !== "owner" && changeSet.author.role !== "editor") {
      addRequiredIssue(
        context,
        ["author", "role"],
        "Only owners and editors can author change sets.",
      );
    }
    if (changeSet.baseRevision.projectId !== changeSet.projectId) {
      addRequiredIssue(
        context,
        ["baseRevision", "projectId"],
        "The base revision must belong to the change set project.",
      );
    }
    if (new Set(changeSet.sourceProposalIds).size !== changeSet.sourceProposalIds.length) {
      addRequiredIssue(
        context,
        ["sourceProposalIds"],
        "Source proposal IDs must be unique.",
      );
    }
    if (Date.parse(changeSet.updatedAt) < Date.parse(changeSet.createdAt)) {
      addRequiredIssue(
        context,
        ["updatedAt"],
        "A change set cannot be updated before it is created.",
      );
    }

    const candidate = changeSet.candidateRevision;
    if (candidate !== null) {
      if (candidate.projectId !== changeSet.projectId) {
        addRequiredIssue(
          context,
          ["candidateRevision", "projectId"],
          "The candidate revision must belong to the change set project.",
        );
      }
      if (candidate.parentRevisionId !== changeSet.baseRevision.revisionId) {
        addRequiredIssue(
          context,
          ["candidateRevision", "parentRevisionId"],
          "The candidate revision must descend from the base revision.",
        );
      }
      if (candidate.sequence !== changeSet.baseRevision.sequence + 1) {
        addRequiredIssue(
          context,
          ["candidateRevision", "sequence"],
          "The candidate sequence must immediately follow the base revision.",
        );
      }
      if (candidate.digest === changeSet.baseRevision.digest) {
        addRequiredIssue(
          context,
          ["candidateRevision", "digest"],
          "A candidate revision must differ from its base.",
        );
      }
    }

    if (changeSet.latestTest !== null) {
      if (
        candidate === null ||
        changeSet.latestTest.revisionId !== candidate.revisionId ||
        changeSet.latestTest.revisionDigest !== candidate.digest
      ) {
        addRequiredIssue(
          context,
          ["latestTest", "revisionId"],
          "The latest test must target the current candidate revision.",
        );
      }
    }

    if (changeSet.review !== null) {
      if (
        candidate === null ||
        changeSet.review.revisionId !== candidate.revisionId
      ) {
        addRequiredIssue(
          context,
          ["review", "revisionId"],
          "The review must target the current candidate revision.",
        );
      }
      if (
        candidate === null ||
        changeSet.review.revisionDigest !== candidate.digest
      ) {
        addRequiredIssue(
          context,
          ["review", "revisionDigest"],
          "The review must target the current candidate digest.",
        );
      }
    }

    const statusNeedsCandidate = changeSet.status !== "draft" && changeSet.status !== "superseded";
    if (statusNeedsCandidate && candidate === null) {
      addRequiredIssue(
        context,
        ["candidateRevision"],
        "This change set status requires a candidate revision.",
      );
    }
    if (statusNeedsCandidate && changeSet.operations.length === 0) {
      addRequiredIssue(
        context,
        ["operations"],
        "This change set status requires at least one operation.",
      );
    }

    const needsPassingApproval = [
      "approved",
      "publishing",
      "published",
      "publish-failed",
    ].includes(changeSet.status);
    if (needsPassingApproval) {
      if (changeSet.latestTest?.status !== "passed") {
        addRequiredIssue(
          context,
          ["latestTest"],
          "Approval and publication require a passing sandbox test.",
        );
      }
      if (changeSet.review?.decision !== "approve") {
        addRequiredIssue(
          context,
          ["review"],
          "Approval and publication require an owner approval.",
        );
      }
      if (
        changeSet.latestTest !== null &&
        changeSet.review !== null &&
        Date.parse(changeSet.review.decidedAt) <
          Date.parse(changeSet.latestTest.completedAt)
      ) {
        addRequiredIssue(
          context,
          ["review", "decidedAt"],
          "Approval must occur after the passing sandbox test.",
        );
      }
    }

    if (
      changeSet.status === "changes-requested" &&
      changeSet.review?.decision !== "request-changes"
    ) {
      addRequiredIssue(
        context,
        ["review"],
        "Changes-requested status requires the matching review decision.",
      );
    }
    if (changeSet.status === "rejected" && changeSet.review?.decision !== "reject") {
      addRequiredIssue(
        context,
        ["review"],
        "Rejected status requires the matching review decision.",
      );
    }

    const statusPublication =
      changeSet.status === "publishing"
        ? "pending"
        : changeSet.status === "published"
          ? "succeeded"
          : changeSet.status === "publish-failed"
            ? "failed"
            : null;
    if (statusPublication === null && changeSet.publication !== null) {
      addRequiredIssue(
        context,
        ["publication"],
        "Publication metadata is not valid in this change set status.",
      );
    }
    if (
      statusPublication !== null &&
      changeSet.publication?.status !== statusPublication
    ) {
      addRequiredIssue(
        context,
        ["publication"],
        `The ${changeSet.status} status requires ${statusPublication} publication metadata.`,
      );
    }

    if (changeSet.status === "superseded") {
      if (
        changeSet.supersededByChangeSetId === null ||
        changeSet.supersededByChangeSetId === changeSet.changeSetId
      ) {
        addRequiredIssue(
          context,
          ["supersededByChangeSetId"],
          "A superseded change set must reference a different replacement.",
        );
      }
    } else if (changeSet.supersededByChangeSetId !== null) {
      addRequiredIssue(
        context,
        ["supersededByChangeSetId"],
        "Only superseded change sets can name a replacement.",
      );
    }

    if (
      ["draft", "proposed", "testing"].includes(changeSet.status) &&
      changeSet.review !== null
    ) {
      addRequiredIssue(
        context,
        ["review"],
        "Pre-review change sets cannot have a review decision.",
      );
    }
  });
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export function parseChangeProposal(value: unknown): ChangeProposal {
  return ChangeProposalSchema.parse(value);
}

export function parseChangeSet(value: unknown): ChangeSet {
  return ChangeSetSchema.parse(value);
}
