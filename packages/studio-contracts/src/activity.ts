import { z } from "zod";
import {
  canTransitionChangeSet,
  ChangeSetStatusSchema,
  PublicationRecordSchema,
  SandboxTestRecordSchema,
} from "./changes.js";
import { ChatChannelSchema } from "./chat.js";
import { ImageAssetDescriptorSchema } from "./operations.js";
import {
  type Actor,
  ActorSchema,
  ExplanationSchema,
  IsoDateTimeSchema,
  RevisionDigestMetadataSchema,
  StudioIdSchema,
} from "./primitives.js";

function actorsAreIdentical(left: Actor, right: Actor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "system") {
    return right.kind === "system" && left.service === right.service;
  }
  return (
    right.kind === "user" &&
    left.userId === right.userId &&
    left.displayName === right.displayName &&
    left.role === right.role
  );
}

const ActivityBaseShape = {
  schemaVersion: z.literal(1),
  eventId: StudioIdSchema,
  workspaceId: StudioIdSchema,
  projectId: StudioIdSchema,
  actor: ActorSchema,
  occurredAt: IsoDateTimeSchema,
} as const;

const RevisionCreatedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("revision.created"),
    revision: RevisionDigestMetadataSchema,
    explanation: ExplanationSchema,
  })
  .strict();

const ProposalCreatedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("proposal.created"),
    proposalId: StudioIdSchema,
    title: z.string().trim().min(1).max(120),
    explanation: ExplanationSchema,
  })
  .strict();

const ChangeSetStatusChangedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("change-set.status-changed"),
    changeSetId: StudioIdSchema,
    fromStatus: ChangeSetStatusSchema,
    toStatus: ChangeSetStatusSchema,
    explanation: ExplanationSchema,
  })
  .strict();

const TestRecordedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("test.recorded"),
    changeSetId: StudioIdSchema,
    test: SandboxTestRecordSchema,
  })
  .strict();

const ChatMessagePostedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("chat.message-posted"),
    messageId: StudioIdSchema,
    threadId: StudioIdSchema,
    channel: ChatChannelSchema,
  })
  .strict();

const AssetStagedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("asset.staged"),
    changeSetId: StudioIdSchema,
    asset: ImageAssetDescriptorSchema,
    explanation: ExplanationSchema,
  })
  .strict();

const PublishCompletedActivitySchema = z
  .object({
    ...ActivityBaseShape,
    kind: z.literal("publish.completed"),
    changeSetId: StudioIdSchema,
    publication: PublicationRecordSchema,
  })
  .strict();

export const ActivityEventSchema = z
  .discriminatedUnion("kind", [
    RevisionCreatedActivitySchema,
    ProposalCreatedActivitySchema,
    ChangeSetStatusChangedActivitySchema,
    TestRecordedActivitySchema,
    ChatMessagePostedActivitySchema,
    AssetStagedActivitySchema,
    PublishCompletedActivitySchema,
  ])
  .superRefine((event, context) => {
    if (event.kind === "revision.created") {
      if (event.revision.projectId !== event.projectId) {
        context.addIssue({
          code: "custom",
          path: ["revision", "projectId"],
          message: "The revision must belong to the activity project.",
        });
      }
      if (!actorsAreIdentical(event.actor, event.revision.createdBy)) {
        context.addIssue({
          code: "custom",
          path: ["revision", "createdBy"],
          message: "The revision activity actor must be its recorded creator.",
        });
      }
      if (
        event.actor.kind === "user" &&
        event.actor.role !== "owner" &&
        event.actor.role !== "editor"
      ) {
        context.addIssue({
          code: "custom",
          path: ["actor", "role"],
          message: "Only owners and editors can create revisions.",
        });
      }
    }

    if (event.kind === "change-set.status-changed") {
      if (!canTransitionChangeSet(event.fromStatus, event.toStatus)) {
        context.addIssue({
          code: "custom",
          path: ["toStatus"],
          message: "This change set status transition is not allowed.",
        });
      }
      if (
        event.toStatus === "approved" &&
        (event.actor.kind !== "user" || event.actor.role !== "owner")
      ) {
        context.addIssue({
          code: "custom",
          path: ["actor"],
          message: "Only an owner can record the approved transition.",
        });
      }
    }

    if (event.kind === "test.recorded") {
      if (
        event.actor.kind !== "user" ||
        event.actor.userId !== event.test.executedBy.userId
      ) {
        context.addIssue({
          code: "custom",
          path: ["actor"],
          message: "The test activity actor must be the test executor.",
        });
      }
    }

    if (event.kind === "asset.staged") {
      if (
        event.actor.kind === "user" &&
        event.actor.role !== "owner" &&
        event.actor.role !== "editor"
      ) {
        context.addIssue({
          code: "custom",
          path: ["actor", "role"],
          message: "Only owners and editors can stage assets.",
        });
      }
    }

    if (
      event.kind === "publish.completed" &&
      event.publication.status !== "succeeded"
    ) {
      context.addIssue({
        code: "custom",
        path: ["publication", "status"],
        message: "A publish-completed event requires successful publication metadata.",
      });
    }
  });
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export function parseActivityEvent(value: unknown): ActivityEvent {
  return ActivityEventSchema.parse(value);
}
