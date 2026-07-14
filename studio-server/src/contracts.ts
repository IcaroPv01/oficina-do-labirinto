import {
  ActivityEventSchema,
  ApprovalRecordSchema,
  canTransitionChangeSet,
  ChangeOperationsSchema,
  ChangeSetSchema,
  SandboxTestRecordSchema,
  type ActivityEvent,
  type ApprovalRecord,
  type ChangeOperation,
  type ChangeSet,
  type ChangeSetStatus,
  type RevisionDigestMetadata,
  type SandboxTestRecord,
  type UserActor,
  type WorkspaceRole,
} from "@collaborative-roguelike/studio-contracts";
import { HttpError } from "./errors.js";

export type {
  ActivityEvent,
  ApprovalRecord,
  ChangeOperation,
  ChangeSet,
  ChangeSetStatus,
  RevisionDigestMetadata,
  SandboxTestRecord,
  UserActor,
  WorkspaceRole,
};

const workspaceRoles = new Set<WorkspaceRole>(["owner", "editor", "reviewer", "viewer"]);

/** Keep contract coupling in one adapter instead of spreading it through routes. */
export function parseWorkspaceRole(value: unknown): WorkspaceRole {
  if (typeof value !== "string" || !workspaceRoles.has(value as WorkspaceRole)) {
    throw new HttpError(400, "invalid_role", "Papel de usuário inválido");
  }
  return value as WorkspaceRole;
}

export function canEdit(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

export function canCreateInvite(role: WorkspaceRole): boolean {
  return role === "owner";
}

function contractError(label: string, issues: readonly { path: PropertyKey[]; message: string }[]): HttpError {
  const fields = issues
    .slice(0, 4)
    .map((issue) => issue.path.map(String).join(".") || label)
    .join(", ");
  return new HttpError(
    400,
    "invalid_contract",
    `${label} inválido nos campos: ${fields}. Use somente comandos estruturados e valores dentro dos limites.`,
  );
}

export function parseChangeOperations(value: unknown): ChangeOperation[] {
  const result = ChangeOperationsSchema.safeParse(value);
  if (!result.success) throw contractError("operations", result.error.issues);
  return result.data;
}

export function parseChangeSet(value: unknown): ChangeSet {
  const result = ChangeSetSchema.safeParse(value);
  if (!result.success) throw contractError("changeSet", result.error.issues);
  return result.data;
}

export function parseSandboxTest(value: unknown): SandboxTestRecord {
  const result = SandboxTestRecordSchema.safeParse(value);
  if (!result.success) throw contractError("sandboxTest", result.error.issues);
  return result.data;
}

export function parseApproval(value: unknown): ApprovalRecord {
  const result = ApprovalRecordSchema.safeParse(value);
  if (!result.success) throw contractError("review", result.error.issues);
  return result.data;
}

export function parseActivity(value: unknown): ActivityEvent {
  const result = ActivityEventSchema.safeParse(value);
  if (!result.success) throw contractError("activity", result.error.issues);
  return result.data;
}

export { canTransitionChangeSet };
