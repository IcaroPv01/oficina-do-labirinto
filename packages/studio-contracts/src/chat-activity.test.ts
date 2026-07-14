import { describe, expect, it } from "vitest";
import { ActivityEventSchema } from "./activity.js";
import { ChatMessageSchema } from "./chat.js";
import {
  BASE_REVISION,
  EDITOR,
  LATEST,
  NOW,
  OWNER,
  PASSING_TEST,
  PENDING_PUBLICATION,
  PROVIDER,
  REVIEWER,
  SUCCESSFUL_PUBLICATION,
} from "./test-fixtures.js";

const TEAM_MESSAGE = {
  schemaVersion: 1,
  messageId: "message-001",
  workspaceId: "workspace-main",
  threadId: "thread-team",
  channel: "team",
  author: EDITOR,
  body: "Mudei a patrulha e deixei a proposta pronta para teste.",
  createdAt: NOW,
  replyToMessageId: null,
  changeSetId: "change-set-001",
  assetIds: [],
} as const;

const ASSISTANT_MESSAGE = {
  ...TEAM_MESSAGE,
  messageId: "message-ai-001",
  threadId: "thread-ai",
  channel: "ai",
  author: {
    kind: "assistant",
    assistantId: "assistant-main",
    displayName: "Assistente do estúdio",
    provider: PROVIDER,
  },
} as const;

describe("chat messages", () => {
  it("keeps team and AI conversations in explicit channels", () => {
    expect(ChatMessageSchema.parse(TEAM_MESSAGE)).toEqual(TEAM_MESSAGE);
    expect(ChatMessageSchema.parse(ASSISTANT_MESSAGE)).toEqual(
      ASSISTANT_MESSAGE,
    );
  });

  it("does not let an assistant impersonate a team-chat user", () => {
    expect(
      ChatMessageSchema.safeParse({
        ...ASSISTANT_MESSAGE,
        channel: "team",
      }).success,
    ).toBe(false);
  });

  it("rejects self-replies, duplicate attachments, blank bodies and extras", () => {
    expect(
      ChatMessageSchema.safeParse({
        ...TEAM_MESSAGE,
        replyToMessageId: TEAM_MESSAGE.messageId,
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...TEAM_MESSAGE,
        assetIds: ["asset-one", "asset-one"],
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({ ...TEAM_MESSAGE, body: "  " }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({ ...TEAM_MESSAGE, rawHtml: "<script />" })
        .success,
    ).toBe(false);
  });
});

describe("activity events", () => {
  it("accepts auditable revision and status events with explanations", () => {
    const revisionEvent = {
      schemaVersion: 1,
      eventId: "event-revision-001",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: OWNER,
      occurredAt: NOW,
      kind: "revision.created",
      revision: BASE_REVISION,
      explanation: "Registra a primeira versão compartilhada.",
    } as const;
    expect(ActivityEventSchema.safeParse(revisionEvent).success).toBe(true);

    const statusEvent = {
      schemaVersion: 1,
      eventId: "event-status-001",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: OWNER,
      occurredAt: LATEST,
      kind: "change-set.status-changed",
      changeSetId: "change-set-001",
      fromStatus: "testing",
      toStatus: "approved",
      explanation: "Sandbox aprovado pelo dono após o teste manual.",
    } as const;
    expect(ActivityEventSchema.safeParse(statusEvent).success).toBe(true);
  });

  it("binds revision activity to the exact user or system creator", () => {
    const userEvent = {
      schemaVersion: 1,
      eventId: "event-revision-actor",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: OWNER,
      occurredAt: NOW,
      kind: "revision.created",
      revision: BASE_REVISION,
      explanation: "Registra a autoria exata da revisão.",
    } as const;
    expect(ActivityEventSchema.safeParse(userEvent).success).toBe(true);
    expect(
      ActivityEventSchema.safeParse({ ...userEvent, actor: EDITOR }).success,
    ).toBe(false);

    const systemActor = { kind: "system", service: "revision-builder" } as const;
    const systemEvent = {
      ...userEvent,
      eventId: "event-revision-system",
      actor: systemActor,
      revision: { ...BASE_REVISION, createdBy: systemActor },
    } as const;
    expect(ActivityEventSchema.safeParse(systemEvent).success).toBe(true);
    expect(
      ActivityEventSchema.safeParse({
        ...systemEvent,
        actor: { kind: "system", service: "other-builder" },
      }).success,
    ).toBe(false);
  });

  it("rejects skipped lifecycle transitions and non-owner approval events", () => {
    const base = {
      schemaVersion: 1,
      eventId: "event-status-001",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: OWNER,
      occurredAt: LATEST,
      kind: "change-set.status-changed",
      changeSetId: "change-set-001",
      fromStatus: "draft",
      toStatus: "published",
      explanation: "Tentativa de pular todo o fluxo.",
    } as const;
    expect(ActivityEventSchema.safeParse(base).success).toBe(false);
    expect(
      ActivityEventSchema.safeParse({
        ...base,
        actor: EDITOR,
        fromStatus: "testing",
        toStatus: "approved",
      }).success,
    ).toBe(false);
  });

  it("binds test activity to the actual executor", () => {
    const event = {
      schemaVersion: 1,
      eventId: "event-test-001",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: REVIEWER,
      occurredAt: LATEST,
      kind: "test.recorded",
      changeSetId: "change-set-001",
      test: PASSING_TEST,
    } as const;
    expect(ActivityEventSchema.safeParse(event).success).toBe(true);
    expect(
      ActivityEventSchema.safeParse({ ...event, actor: OWNER }).success,
    ).toBe(false);
  });

  it("requires successful metadata for publish-completed events", () => {
    const event = {
      schemaVersion: 1,
      eventId: "event-publish-001",
      workspaceId: "workspace-main",
      projectId: "project-main",
      actor: { kind: "system", service: "publisher" },
      occurredAt: LATEST,
      kind: "publish.completed",
      changeSetId: "change-set-001",
      publication: SUCCESSFUL_PUBLICATION,
    } as const;
    expect(ActivityEventSchema.safeParse(event).success).toBe(true);
    expect(
      ActivityEventSchema.safeParse({
        ...event,
        publication: PENDING_PUBLICATION,
      }).success,
    ).toBe(false);
  });

  it("rejects revision events for another project and unknown event fields", () => {
    const event = {
      schemaVersion: 1,
      eventId: "event-revision-001",
      workspaceId: "workspace-main",
      projectId: "project-other",
      actor: OWNER,
      occurredAt: NOW,
      kind: "revision.created",
      revision: BASE_REVISION,
      explanation: "Não pertence a este projeto.",
    } as const;
    expect(ActivityEventSchema.safeParse(event).success).toBe(false);
    expect(
      ActivityEventSchema.safeParse({
        ...event,
        projectId: "project-main",
        credential: "forbidden",
      }).success,
    ).toBe(false);
  });
});
