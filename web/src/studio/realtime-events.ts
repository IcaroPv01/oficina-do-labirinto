import { ChangeSetSchema } from "@collaborative-roguelike/studio-contracts";
import { parseGameProject, type GameProject } from "../core";
import type {
  StudioChangeSetDto,
  StudioChatMessageDto,
  StudioPublicUserDto,
} from "./api-client";
import type { StudioMemberSummary } from "./model";
import type { StudioRealtimeMessage } from "./realtime";

const STUDIO_ROLES = new Set(["owner", "editor", "reviewer", "viewer"]);

export interface RealtimeProjectRevision {
  readonly projectId: string;
  readonly revisionNumber: number;
  readonly project: GameProject;
  readonly createdAt: string;
}

/** Mutations the realtime protocol is allowed to make in the visible projection. */
export interface StudioRealtimeProjection {
  replaceMembers(members: Map<string, StudioMemberSummary>): void;
  upsertMember(member: StudioMemberSummary): void;
  removeMember(clientId: string): void;
  addChat(message: StudioChatMessageDto): void;
  upsertChangeSet(changeSet: StudioChangeSetDto): void;
  applyProjectRevision(revision: RealtimeProjectRevision): void;
}

/**
 * Projects untrusted WebSocket data into validated domain values. Unknown or
 * malformed events are ignored so one bad frame cannot corrupt the Studio UI.
 */
export function applyStudioRealtimeMessage(
  message: StudioRealtimeMessage,
  projection: StudioRealtimeProjection,
): void {
  if (message.type === "chat.created" && isChatMessage(message.message)) {
    projection.addChat(message.message);
    return;
  }

  if (message.type === "change-set.updated") {
    const parsedChangeSet = ChangeSetSchema.safeParse(message.changeSet);
    if (parsedChangeSet.success) {
      projection.upsertChangeSet(parsedChangeSet.data);
    }
    return;
  }

  if (message.type === "project.revision.created") {
    const revision = parseProjectRevision(message.revision);
    if (revision) {
      projection.applyProjectRevision(revision);
    }
    return;
  }

  if (message.type === "ready" && Array.isArray(message.presence)) {
    projection.replaceMembers(presenceMap(message.presence));
    return;
  }

  if (
    (message.type === "presence.join" || message.type === "presence.update") &&
    message.presence
  ) {
    for (const member of presenceMap([message.presence]).values()) {
      projection.upsertMember(member);
    }
    return;
  }

  if (message.type === "presence.leave" && typeof message.clientId === "string") {
    projection.removeMember(message.clientId);
  }
}

export function memberFromStudioUser(
  user: StudioPublicUserDto,
  context?: string,
): StudioMemberSummary {
  const nameParts = user.displayName.trim().split(/\s+/).slice(0, 2);
  return {
    id: user.id,
    displayName: user.displayName,
    initials:
      nameParts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?",
    presence: "online",
    ...(context ? { currentContext: context } : {}),
  };
}

function presenceMap(values: readonly unknown[]): Map<string, StudioMemberSummary> {
  const members = new Map<string, StudioMemberSummary>();
  for (const value of values) {
    if (!isRecord(value)) continue;
    const clientId = value.clientId;
    const user = value.user;
    if (typeof clientId !== "string" || !isPublicUser(user)) continue;

    const context =
      typeof value.entity === "string"
        ? value.entity
        : value.state === "testing"
          ? "Testando"
          : value.state === "editing"
            ? "Editando"
            : undefined;
    members.set(clientId, {
      ...memberFromStudioUser(user, context),
      id: clientId,
    });
  }
  return members;
}

function parseProjectRevision(value: unknown): RealtimeProjectRevision | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.projectId !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }

  try {
    return {
      projectId: value.projectId,
      revisionNumber: value.revision as number,
      project: parseGameProject(value.snapshot),
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

function isPublicUser(value: unknown): value is StudioPublicUserDto {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.role === "string" &&
    STUDIO_ROLES.has(value.role)
  );
}

function isChatMessage(value: unknown): value is StudioChatMessageDto {
  if (!isRecord(value) || !isPublicUserOrNull(value.author)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (value.kind === "human" || value.kind === "assistant" || value.kind === "system") &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string"
  );
}

function isPublicUserOrNull(value: unknown): value is StudioPublicUserDto | null {
  return value === null || isPublicUser(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
