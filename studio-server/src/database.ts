import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseWorkspaceRole, type WorkspaceRole } from "./contracts.js";
import { HttpError } from "./errors.js";

const migrationV1 = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
    role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'reviewer', 'viewer')),
    created_at TEXT NOT NULL,
    disabled_at TEXT
  ) STRICT;

  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'reviewer', 'viewer')),
    created_by TEXT REFERENCES users(id),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    consumed_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
    latest_revision INTEGER NOT NULL DEFAULT 0 CHECK(latest_revision >= 0),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
    parent_revision_number INTEGER CHECK(parent_revision_number >= 1),
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    explanation TEXT NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, revision_number)
  ) STRICT;

  CREATE TABLE change_sets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_revision INTEGER NOT NULL CHECK(base_revision >= 1),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
    explanation TEXT NOT NULL CHECK(length(explanation) BETWEEN 1 AND 4000),
    status TEXT NOT NULL CHECK(status IN (
      'draft', 'proposed', 'testing', 'changes-requested', 'approved', 'rejected',
      'publishing', 'published', 'publish-failed', 'superseded'
    )),
    proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    kind TEXT NOT NULL CHECK(kind IN ('human', 'assistant', 'system')),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 50000),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
    entity_type TEXT NOT NULL CHECK(length(entity_type) BETWEEN 1 AND 50),
    entity_id TEXT,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    decision TEXT NOT NULL CHECK(decision IN ('approve', 'request-changes', 'reject')),
    note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL,
    UNIQUE(change_set_id, reviewer_id)
  ) STRICT;

  CREATE INDEX invites_token_idx ON invites(token_hash);
  CREATE INDEX sessions_token_idx ON sessions(token_hash);
  CREATE INDEX revisions_project_idx ON revisions(project_id, revision_number DESC);
  CREATE INDEX chat_project_idx ON chat_messages(project_id, created_at, id);
  CREATE INDEX activity_project_idx ON activity(project_id, created_at, id);
  CREATE INDEX change_sets_project_idx ON change_sets(project_id, updated_at DESC);
`;

const migrationV2 = `
  CREATE TABLE change_set_versions (
    id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version >= 1),
    document_json TEXT NOT NULL CHECK(json_valid(document_json)),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE(change_set_id, version)
  ) STRICT;

  CREATE TABLE sandbox_tests (
    id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL,
    revision_digest TEXT NOT NULL CHECK(length(revision_digest) = 64),
    test_json TEXT NOT NULL CHECK(json_valid(test_json)),
    recorded_by TEXT NOT NULL REFERENCES users(id),
    recorded_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE change_set_reviews (
    id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL,
    revision_digest TEXT NOT NULL CHECK(length(revision_digest) = 64),
    review_json TEXT NOT NULL CHECK(json_valid(review_json)),
    recorded_by TEXT NOT NULL REFERENCES users(id),
    recorded_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX change_set_versions_idx ON change_set_versions(change_set_id, version DESC);
  CREATE INDEX sandbox_tests_change_set_idx ON sandbox_tests(change_set_id, recorded_at DESC);
  CREATE INDEX change_set_reviews_idx ON change_set_reviews(change_set_id, recorded_at DESC);
`;

const migrationV3 = `
  CREATE TRIGGER change_set_versions_no_update
  BEFORE UPDATE ON change_set_versions
  BEGIN
    SELECT RAISE(ABORT, 'change_set_versions is immutable');
  END;

  CREATE TRIGGER change_set_versions_no_delete
  BEFORE DELETE ON change_set_versions
  BEGIN
    SELECT RAISE(ABORT, 'change_set_versions is immutable');
  END;

  CREATE TRIGGER sandbox_tests_no_update
  BEFORE UPDATE ON sandbox_tests
  BEGIN
    SELECT RAISE(ABORT, 'sandbox_tests is immutable');
  END;

  CREATE TRIGGER sandbox_tests_no_delete
  BEFORE DELETE ON sandbox_tests
  BEGIN
    SELECT RAISE(ABORT, 'sandbox_tests is immutable');
  END;

  CREATE TRIGGER change_set_reviews_no_update
  BEFORE UPDATE ON change_set_reviews
  BEGIN
    SELECT RAISE(ABORT, 'change_set_reviews is immutable');
  END;

  CREATE TRIGGER change_set_reviews_no_delete
  BEFORE DELETE ON change_set_reviews
  BEGIN
    SELECT RAISE(ABORT, 'change_set_reviews is immutable');
  END;
`;

const migrationV4 = `
  CREATE TRIGGER activity_no_update
  BEFORE UPDATE ON activity
  BEGIN
    SELECT RAISE(ABORT, 'activity is append-only');
  END;

  CREATE TRIGGER activity_no_delete
  BEFORE DELETE ON activity
  BEGIN
    SELECT RAISE(ABORT, 'activity is append-only');
  END;
`;

const migrations = [
  { version: 1, sql: migrationV1 },
  { version: 2, sql: migrationV2 },
  { version: 3, sql: migrationV3 },
  { version: 4, sql: migrationV4 },
] as const;

export interface PublicUser {
  readonly id: string;
  readonly displayName: string;
  readonly role: WorkspaceRole;
}

export interface SessionPrincipal {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly user: PublicUser;
}

export interface NewSession extends SessionPrincipal {
  readonly sessionToken: string;
}

export interface CreatedCredential<T> {
  readonly token: string;
  readonly value: T;
}

export interface InviteView {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly latestRevision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RevisionView {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly snapshot: Record<string, unknown>;
  readonly explanation: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ChatMessageView {
  readonly id: string;
  readonly projectId: string;
  readonly author: PublicUser | null;
  readonly kind: "human" | "assistant" | "system";
  readonly body: string;
  readonly createdAt: string;
}

export interface AiProposalAuditRecord {
  readonly proposalId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly promptDigest: string;
  readonly author: PublicUser;
  readonly provider: string;
  readonly model: string;
  readonly requestId: string | null;
  readonly candidate: {
    readonly title: string;
    readonly explanation: string;
    readonly operations: readonly unknown[];
    readonly risks: readonly string[];
  };
}

type UserRow = { id: string; display_name: string; role: string };
type SessionRow = UserRow & {
  session_id: string;
  csrf_token: string;
  expires_at: string;
  last_seen_at: string;
};
type InviteRow = {
  id: string;
  role: string;
  expires_at: string;
  consumed_at: string | null;
};
type ProjectRow = {
  id: string;
  name: string;
  latest_revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type RevisionRow = {
  id: string;
  project_id: string;
  revision_number: number;
  parent_revision_number: number | null;
  snapshot_json: string;
  explanation: string;
  created_by: string;
  created_at: string;
};
type ChatRow = {
  id: string;
  project_id: string;
  author_id: string | null;
  display_name: string | null;
  role: string | null;
  kind: "human" | "assistant" | "system";
  body: string;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function toUser(row: UserRow): PublicUser {
  return { id: row.id, displayName: row.display_name, role: parseWorkspaceRole(row.role) };
}

function toProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    latestRevision: row.latest_revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRevision(row: RevisionRow): RevisionView {
  return {
    id: row.id,
    projectId: row.project_id,
    revision: row.revision_number,
    parentRevision: row.parent_revision_number,
    snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>,
    explanation: row.explanation,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class StudioDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    this.connection.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const appliedRows = this.connection.prepare("SELECT version FROM schema_migrations").all() as Array<{
      version: number;
    }>;
    const applied = new Set(appliedRows.map((row) => row.version));

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(migration.version, nowIso());
      });
    }
  }

  private transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }

  createInvite(role: WorkspaceRole, createdBy: string | null, ttlMs: number): CreatedCredential<InviteView> {
    const parsedRole = parseWorkspaceRole(role);
    const token = randomToken("inv");
    const id = randomUUID();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.connection
      .prepare(
        `INSERT INTO invites(id, token_hash, role, created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, hashToken(token), parsedRole, createdBy, expiresAt, createdAt);
    return { token, value: { id, role: parsedRole, expiresAt, createdAt } };
  }

  redeemInvite(token: string, displayName: string, sessionTtlMs: number): NewSession {
    return this.transaction(() => {
      const row = this.connection
        .prepare("SELECT id, role, expires_at, consumed_at FROM invites WHERE token_hash = ?")
        .get(hashToken(token)) as InviteRow | undefined;
      if (!row || row.consumed_at !== null || Date.parse(row.expires_at) <= Date.now()) {
        throw new HttpError(401, "invalid_invite", "Convite inválido, expirado ou já utilizado");
      }

      const userId = randomUUID();
      const createdAt = nowIso();
      const role = parseWorkspaceRole(row.role);
      this.connection
        .prepare("INSERT INTO users(id, display_name, role, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, displayName, role, createdAt);
      const consumed = this.connection
        .prepare("UPDATE invites SET consumed_at = ?, consumed_by = ? WHERE id = ? AND consumed_at IS NULL")
        .run(createdAt, userId, row.id);
      if (Number(consumed.changes) !== 1) {
        throw new HttpError(409, "invite_consumed", "O convite já foi utilizado");
      }
      return this.createSessionForUser({ id: userId, displayName, role }, sessionTtlMs);
    });
  }

  createDevSession(displayName: string, sessionTtlMs: number): NewSession {
    const id = "dev-local-owner";
    const createdAt = nowIso();
    this.connection
      .prepare(
        `INSERT INTO users(id, display_name, role, created_at)
         VALUES (?, ?, 'owner', ?)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, disabled_at = NULL`,
      )
      .run(id, displayName, createdAt);
    return this.createSessionForUser({ id, displayName, role: "owner" }, sessionTtlMs);
  }

  private createSessionForUser(user: PublicUser, ttlMs: number): NewSession {
    const sessionToken = randomToken("ses");
    const csrfToken = randomToken("csrf");
    const sessionId = randomUUID();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.connection
      .prepare(
        `INSERT INTO sessions(id, token_hash, csrf_token, user_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, hashToken(sessionToken), csrfToken, user.id, expiresAt, createdAt, createdAt);
    return { sessionId, sessionToken, csrfToken, expiresAt, user };
  }

  getSession(token: string): SessionPrincipal | null {
    const row = this.connection
      .prepare(
        `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at,
                u.id, u.display_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND u.disabled_at IS NULL`,
      )
      .get(hashToken(token)) as SessionRow | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.connection.prepare("DELETE FROM sessions WHERE id = ?").run(row.session_id);
      return null;
    }
    if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1_000) {
      this.connection.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.session_id);
    }
    return {
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      user: toUser(row),
    };
  }

  deleteSession(token: string): void {
    this.connection.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  listProjects(): ProjectSummary[] {
    return (this.connection.prepare("SELECT * FROM projects ORDER BY updated_at DESC, id").all() as ProjectRow[]).map(
      toProject,
    );
  }

  getProject(id: string): ProjectSummary | null {
    const row = this.connection.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  createProject(
    name: string,
    snapshot: Record<string, unknown>,
    explanation: string,
    user: PublicUser,
  ): { project: ProjectSummary; revision: RevisionView } {
    return this.transaction(() => {
      const projectId = randomUUID();
      const revisionId = randomUUID();
      const createdAt = nowIso();
      this.connection
        .prepare(
          `INSERT INTO projects(id, name, latest_revision, created_by, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)`,
        )
        .run(projectId, name, user.id, createdAt, createdAt);
      this.connection
        .prepare(
          `INSERT INTO revisions(
             id, project_id, revision_number, parent_revision_number, snapshot_json,
             explanation, created_by, created_at
           ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?)`,
        )
        .run(revisionId, projectId, JSON.stringify(snapshot), explanation, user.id, createdAt);
      this.insertActivity(projectId, user.id, "revision.created", "revision", revisionId, { revision: 1 });
      return {
        project: {
          id: projectId,
          name,
          latestRevision: 1,
          createdBy: user.id,
          createdAt,
          updatedAt: createdAt,
        },
        revision: {
          id: revisionId,
          projectId,
          revision: 1,
          parentRevision: null,
          snapshot,
          explanation,
          createdBy: user.id,
          createdAt,
        },
      };
    });
  }

  getLatestRevision(projectId: string): RevisionView | null {
    const row = this.connection
      .prepare("SELECT * FROM revisions WHERE project_id = ? ORDER BY revision_number DESC LIMIT 1")
      .get(projectId) as RevisionRow | undefined;
    return row ? toRevision(row) : null;
  }

  updateSnapshot(
    projectId: string,
    baseRevision: number,
    snapshot: Record<string, unknown>,
    explanation: string,
    user: PublicUser,
  ): { project: ProjectSummary; revision: RevisionView } {
    return this.transaction(() => {
      const projectRow = this.connection.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
        | ProjectRow
        | undefined;
      if (!projectRow) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
      if (projectRow.latest_revision !== baseRevision) {
        throw new HttpError(409, "revision_conflict", `O projeto avançou para a revisão ${projectRow.latest_revision}`);
      }

      const nextRevision = baseRevision + 1;
      const id = randomUUID();
      const createdAt = nowIso();
      this.connection
        .prepare(
          `INSERT INTO revisions(
             id, project_id, revision_number, parent_revision_number, snapshot_json,
             explanation, created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, projectId, nextRevision, baseRevision, JSON.stringify(snapshot), explanation, user.id, createdAt);
      this.connection
        .prepare("UPDATE projects SET latest_revision = ?, updated_at = ? WHERE id = ?")
        .run(nextRevision, createdAt, projectId);
      this.insertActivity(projectId, user.id, "revision.created", "revision", id, {
        revision: nextRevision,
        baseRevision,
      });

      return {
        project: { ...toProject(projectRow), latestRevision: nextRevision, updatedAt: createdAt },
        revision: {
          id,
          projectId,
          revision: nextRevision,
          parentRevision: baseRevision,
          snapshot,
          explanation,
          createdBy: user.id,
          createdAt,
        },
      };
    });
  }

  addChatMessage(projectId: string, user: PublicUser, body: string): ChatMessageView {
    if (!this.getProject(projectId)) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
    const message: ChatMessageView = {
      id: randomUUID(),
      projectId,
      author: user,
      kind: "human",
      body,
      createdAt: nowIso(),
    };
    this.transaction(() => {
      this.connection
        .prepare(
          `INSERT INTO chat_messages(id, project_id, author_id, kind, body, created_at)
           VALUES (?, ?, ?, 'human', ?, ?)`,
        )
        .run(message.id, projectId, user.id, body, message.createdAt);
      this.insertActivity(projectId, user.id, "chat.message-posted", "chat_message", message.id, {});
    });
    return message;
  }

  listChatMessages(projectId: string, after: string | undefined, limit: number): ChatMessageView[] {
    if (!this.getProject(projectId)) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
    const rows = (after
      ? this.connection
          .prepare(
            `SELECT m.*, u.display_name, u.role FROM chat_messages m
             LEFT JOIN users u ON u.id = m.author_id
             WHERE m.project_id = ? AND m.created_at > ?
             ORDER BY m.created_at, m.id LIMIT ?`,
          )
          .all(projectId, after, limit)
      : this.connection
          .prepare(
            `SELECT m.*, u.display_name, u.role FROM chat_messages m
             LEFT JOIN users u ON u.id = m.author_id
             WHERE m.project_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
          )
          .all(projectId, limit)) as ChatRow[];
    if (!after) rows.reverse();
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      author:
        row.author_id && row.display_name && row.role
          ? { id: row.author_id, displayName: row.display_name, role: parseWorkspaceRole(row.role) }
          : null,
      kind: row.kind,
      body: row.body,
      createdAt: row.created_at,
    }));
  }

  /**
   * Persists only the digest of the user's prompt. The proposal ID is the
   * durable audit handle later carried by ChangeSet.sourceProposalIds.
   */
  appendAiProposalActivity(record: AiProposalAuditRecord): void {
    if (!this.getProject(record.projectId)) {
      throw new HttpError(404, "project_not_found", "Projeto não encontrado");
    }
    const data = {
      schemaVersion: 1,
      proposalId: record.proposalId,
      projectId: record.projectId,
      createdAt: record.createdAt,
      promptDigest: record.promptDigest,
      author: record.author,
      provider: record.provider,
      model: record.model,
      requestId: record.requestId,
      candidate: record.candidate,
      applied: false,
    };
    this.connection
      .prepare(
        `INSERT INTO activity(
           id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, 'ai-proposal.created', 'ai-proposal', ?, ?, ?)`,
      )
      .run(randomUUID(), record.projectId, record.author.id, record.proposalId, JSON.stringify(data), record.createdAt);
  }

  private insertActivity(
    projectId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO activity(
           id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), projectId, actorId, action, entityType, entityId, JSON.stringify(metadata), nowIso());
  }
}
