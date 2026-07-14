import { randomUUID } from "node:crypto";
import { digestCanonicalJson } from "./canonical-json.js";
import {
  canTransitionChangeSet,
  parseActivity,
  parseApproval,
  parseChangeOperations,
  parseChangeSet,
  parseSandboxTest,
  parseWorkspaceRole,
  type ActivityEvent,
  type ApprovalRecord,
  type ChangeOperation,
  type ChangeSet,
  type ChangeSetStatus,
  type RevisionDigestMetadata,
  type SandboxTestRecord,
  type UserActor,
} from "./contracts.js";
import type { PublicUser, StudioDatabase } from "./database.js";
import { HttpError } from "./errors.js";

const MAXIMUM_TEST_DURATION_MS = 60 * 60_000;
const ALLOWED_CLOCK_SKEW_MS = 5 * 60_000;
const MAXIMUM_DETAIL_AUDIT_RECORDS = 200;
const MAXIMUM_LISTED_CHANGE_SETS = 500;

interface ChangeSetRow {
  id: string;
  project_id: string;
  base_revision: number;
  status: ChangeSetStatus;
  proposal_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ProjectRevisionRow {
  id: string;
  project_id: string;
  revision_number: number;
  parent_revision_number: number | null;
  snapshot_json: string;
  created_at: string;
  user_id: string;
  display_name: string;
  role: string;
}

interface VersionRow {
  version: number;
  document_json: string;
  reason: string;
  created_by: string;
  created_at: string;
}

interface TestRow {
  test_json: string;
}

interface ReviewRow {
  id: string;
  revision_id: string;
  revision_digest: string;
  review_json: string;
  recorded_at: string;
}

interface ActivityRow {
  id: string;
  project_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata_json: string;
  created_at: string;
}

export interface CreateChangeSetInput {
  readonly title: string;
  readonly explanation: string;
  readonly operations: unknown;
  readonly sourceProposalIds?: readonly string[];
}

export interface EditChangeSetInput {
  readonly baseVersion: number;
  readonly title?: string;
  readonly explanation?: string;
  readonly operations?: unknown;
  readonly sourceProposalIds?: readonly string[];
  readonly reason: string;
}

export interface SandboxCheckInput {
  readonly checkId?: string;
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly details: string | null;
}

export interface RecordSandboxTestInput {
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly status: "passed" | "failed";
  readonly checks: readonly SandboxCheckInput[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface ReviewChangeSetInput {
  readonly decision: "approve" | "request-changes" | "reject";
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly explanation: string;
}

export interface ChangeSetVersionSummary {
  readonly version: number;
  readonly status: ChangeSetStatus;
  readonly candidateRevision: RevisionDigestMetadata | null;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ReviewAuditView {
  readonly id: string;
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly review: ApprovalRecord;
  readonly recordedAt: string;
}

export interface ChangeSetDetailDto {
  readonly changeSet: ChangeSet;
  readonly version: number;
  readonly history: readonly ChangeSetVersionSummary[];
  readonly testRuns: readonly SandboxTestRecord[];
  readonly reviews: readonly ReviewAuditView[];
}

export interface ActivityDto {
  readonly id: string;
  readonly projectId: string;
  readonly actorId: string | null;
  readonly kind: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly data: unknown;
  readonly createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function userActor(user: PublicUser): UserActor {
  return {
    kind: "user",
    userId: user.id,
    displayName: user.displayName,
    role: user.role,
  };
}

function validateSourceProposalIds(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  if (value.length > 16 || new Set(value).size !== value.length) {
    throw new HttpError(400, "invalid_source_proposals", "sourceProposalIds deve conter até 16 IDs únicos");
  }
  for (const id of value) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,126}[A-Za-z0-9]$/.test(id)) {
      throw new HttpError(400, "invalid_source_proposals", "sourceProposalIds contém um ID inválido");
    }
  }
  return [...value];
}

/**
 * Owns the draft -> sandbox -> review state machine. Every mutable action appends
 * an immutable version, and approval is bound to one passing candidate digest.
 */
export class ChangeSetService {
  constructor(private readonly database: StudioDatabase) {}

  list(projectId: string): ChangeSet[] {
    this.assertProject(projectId);
    const rows = this.database.connection
      .prepare("SELECT * FROM change_sets WHERE project_id = ? ORDER BY updated_at DESC, id LIMIT ?")
      .all(projectId, MAXIMUM_LISTED_CHANGE_SETS) as unknown as ChangeSetRow[];
    return rows.map((row) => this.parseStoredChangeSet(row));
  }

  getDetail(projectId: string, changeSetId: string): ChangeSetDetailDto {
    const row = this.loadChangeSetRow(projectId, changeSetId);
    const changeSet = this.parseStoredChangeSet(row);
    const versionRows = this.database.connection
      .prepare(
        `SELECT version, document_json, reason, created_by, created_at
         FROM change_set_versions WHERE change_set_id = ? ORDER BY version DESC LIMIT ?`,
      )
      .all(changeSetId, MAXIMUM_DETAIL_AUDIT_RECORDS) as unknown as VersionRow[];
    const testRows = this.database.connection
      .prepare("SELECT test_json FROM sandbox_tests WHERE change_set_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?")
      .all(changeSetId, MAXIMUM_DETAIL_AUDIT_RECORDS) as unknown as TestRow[];
    const reviewRows = this.database.connection
      .prepare(
        `SELECT id, revision_id, revision_digest, review_json, recorded_at
         FROM change_set_reviews WHERE change_set_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?`,
      )
      .all(changeSetId, MAXIMUM_DETAIL_AUDIT_RECORDS) as unknown as ReviewRow[];
    return {
      changeSet,
      version: versionRows[0]?.version ?? 0,
      history: versionRows.map((version) => {
        const document = parseChangeSet(JSON.parse(version.document_json) as unknown);
        return {
          version: version.version,
          status: document.status,
          candidateRevision: document.candidateRevision,
          reason: version.reason,
          createdBy: version.created_by,
          createdAt: version.created_at,
        };
      }),
      testRuns: testRows.map((test) => parseSandboxTest(JSON.parse(test.test_json) as unknown)),
      reviews: reviewRows.map((review) => ({
        id: review.id,
        revisionId: review.revision_id,
        revisionDigest: review.revision_digest,
        review: parseApproval(JSON.parse(review.review_json) as unknown),
        recordedAt: review.recorded_at,
      })),
    };
  }

  create(projectId: string, input: CreateChangeSetInput, user: PublicUser): ChangeSetDetailDto {
    this.requireEditor(user);
    const baseRevision = this.loadCurrentProjectRevisionDigest(projectId);
    const operations = parseChangeOperations(input.operations);
    const sourceProposalIds = validateSourceProposalIds(input.sourceProposalIds);
    const actor = userActor(user);
    const createdAt = nowIso();
    const changeSetId = randomUUID();
    const candidateRevision =
      operations.length === 0
        ? null
        : this.createCandidateRevisionDigest(
            projectId,
            baseRevision,
            input.title,
            input.explanation,
            operations,
            sourceProposalIds,
            actor,
            createdAt,
          );
    const changeSet = parseChangeSet({
      schemaVersion: 1,
      changeSetId,
      workspaceId: projectId,
      projectId,
      title: input.title,
      explanation: input.explanation,
      status: "draft",
      baseRevision,
      candidateRevision,
      sourceProposalIds,
      operations,
      author: actor,
      createdAt,
      updatedAt: createdAt,
      latestTest: null,
      review: null,
      publication: null,
      supersededByChangeSetId: null,
    });

    this.runInTransaction(() => {
      this.database.connection
        .prepare(
          `INSERT INTO change_sets(
             id, project_id, base_revision, title, explanation, status, proposal_json,
             created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          changeSetId,
          projectId,
          baseRevision.sequence + 1,
          changeSet.title,
          changeSet.explanation,
          changeSet.status,
          JSON.stringify(changeSet),
          user.id,
          createdAt,
          createdAt,
        );
      this.appendImmutableVersion(changeSet, input.explanation, user.id, createdAt);
      this.insertGenericActivity(projectId, user.id, "change-set.created", "change_set", changeSetId, {
        changeSetId,
        title: changeSet.title,
        explanation: changeSet.explanation,
      });
      if (candidateRevision) this.insertRevisionActivity(changeSet, candidateRevision, actor, input.explanation, createdAt);
    });
    return this.getDetail(projectId, changeSetId);
  }

  /** A content edit always creates a fresh candidate and clears current test/review evidence. */
  edit(projectId: string, changeSetId: string, input: EditChangeSetInput, user: PublicUser): ChangeSetDetailDto {
    this.requireEditor(user);
    const row = this.loadChangeSetRow(projectId, changeSetId);
    const current = this.parseStoredChangeSet(row);
    const latestVersion = this.loadLatestVersion(changeSetId);
    if (latestVersion !== input.baseVersion) {
      throw new HttpError(
        409,
        "change_set_version_conflict",
        `O conjunto avançou para a versão ${latestVersion}; recarregue antes de editar`,
      );
    }
    if (current.status !== "draft" && current.status !== "changes-requested") {
      throw new HttpError(409, "change_set_locked", "Solicite alterações antes de editar este conjunto");
    }
    const title = input.title ?? current.title;
    const explanation = input.explanation ?? current.explanation;
    const operations = input.operations === undefined ? current.operations : parseChangeOperations(input.operations);
    const sourceProposalIds =
      input.sourceProposalIds === undefined
        ? current.sourceProposalIds
        : validateSourceProposalIds(input.sourceProposalIds);
    const before = digestCanonicalJson({
      title: current.title,
      explanation: current.explanation,
      operations: current.operations,
      sourceProposalIds: current.sourceProposalIds,
    }).digest;
    const after = digestCanonicalJson({ title, explanation, operations, sourceProposalIds }).digest;
    if (before === after) throw new HttpError(400, "no_change", "A edição não altera o conjunto");

    const actor = userActor(user);
    const updatedAt = nowIso();
    const candidateRevision =
      operations.length === 0
        ? null
        : this.createCandidateRevisionDigest(
            projectId,
            current.baseRevision,
            title,
            explanation,
            operations,
            sourceProposalIds,
            actor,
            updatedAt,
          );
    const updated = parseChangeSet({
      ...current,
      title,
      explanation,
      operations,
      sourceProposalIds,
      status: "draft",
      candidateRevision,
      latestTest: null,
      review: null,
      publication: null,
      supersededByChangeSetId: null,
      updatedAt,
    });

    this.runInTransaction(() => {
      this.persistChangeSetVersion(updated, input.reason, user.id, updatedAt);
      if (current.status !== updated.status) {
        this.insertStatusActivity(updated, current.status, updated.status, actor, input.reason, updatedAt);
      }
      if (candidateRevision) this.insertRevisionActivity(updated, candidateRevision, actor, input.reason, updatedAt);
    });
    return this.getDetail(projectId, changeSetId);
  }

  markReady(projectId: string, changeSetId: string, explanation: string, user: PublicUser): ChangeSetDetailDto {
    this.requireEditor(user);
    return this.transitionStatus(projectId, changeSetId, "proposed", explanation, user);
  }

  markTesting(projectId: string, changeSetId: string, explanation: string, user: PublicUser): ChangeSetDetailDto {
    if (user.role === "viewer") throw new HttpError(403, "tester_required", "Permissão de teste necessária");
    return this.transitionStatus(projectId, changeSetId, "testing", explanation, user);
  }

  /** Test evidence is immutable and accepted only for the exact current candidate ID and digest. */
  recordTest(
    projectId: string,
    changeSetId: string,
    input: RecordSandboxTestInput,
    user: PublicUser,
  ): ChangeSetDetailDto {
    if (user.role === "viewer") throw new HttpError(403, "tester_required", "Permissão de teste necessária");
    const row = this.loadChangeSetRow(projectId, changeSetId);
    const current = this.parseStoredChangeSet(row);
    if (current.status !== "testing") {
      throw new HttpError(409, "not_testing", "O conjunto precisa estar em teste");
    }
    this.assertCandidateIdentity(current, input.revisionId, input.revisionDigest);
    const actor = userActor(user);
    const test = this.buildSandboxTestRecord(input, actor);
    const recordedAt = nowIso();
    const updated = parseChangeSet({ ...current, latestTest: test, updatedAt: recordedAt });
    const reason = `Teste ${test.status === "passed" ? "aprovado" : "falhou"}: ${test.testRunId}`;

    this.runInTransaction(() => {
      this.database.connection
        .prepare(
          `INSERT INTO sandbox_tests(
             id, change_set_id, revision_id, revision_digest, test_json, recorded_by, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          test.testRunId,
          changeSetId,
          test.revisionId,
          test.revisionDigest,
          JSON.stringify(test),
          user.id,
          recordedAt,
        );
      this.persistChangeSetVersion(updated, reason, user.id, recordedAt);
      const event = parseActivity({
        schemaVersion: 1,
        eventId: randomUUID(),
        workspaceId: current.workspaceId,
        projectId,
        actor,
        occurredAt: recordedAt,
        kind: "test.recorded",
        changeSetId,
        test,
      });
      this.insertContractActivity(event, "change_set", changeSetId);
    });
    return this.getDetail(projectId, changeSetId);
  }

  /** Approval additionally requires owner role, passing evidence, and an unchanged project base. */
  review(
    projectId: string,
    changeSetId: string,
    input: ReviewChangeSetInput,
    user: PublicUser,
  ): ChangeSetDetailDto {
    if (user.role !== "owner" && user.role !== "reviewer") {
      throw new HttpError(403, "reviewer_required", "Permissão de revisão necessária");
    }
    const row = this.loadChangeSetRow(projectId, changeSetId);
    const current = this.parseStoredChangeSet(row);
    this.assertCandidateIdentity(current, input.revisionId, input.revisionDigest);
    const target = this.resolveReviewTargetStatus(current, input, user);
    if (!canTransitionChangeSet(current.status, target)) {
      throw new HttpError(409, "invalid_transition", `Transição ${current.status} -> ${target} não permitida`);
    }

    const actor = userActor(user);
    const decidedAt = nowIso();
    const review = parseApproval({
      decision: input.decision,
      revisionId: input.revisionId,
      revisionDigest: input.revisionDigest,
      decidedBy: actor,
      explanation: input.explanation,
      decidedAt,
    });
    const updated = parseChangeSet({ ...current, status: target, review, updatedAt: decidedAt });
    const reviewId = randomUUID();

    this.runInTransaction(() => {
      this.assertStoredChangeSetWasNotChanged(row);
      if (input.decision === "approve") this.assertBaseRevisionIsCurrent(current);
      this.database.connection
        .prepare(
          `INSERT INTO change_set_reviews(
             id, change_set_id, revision_id, revision_digest, review_json, recorded_by, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewId,
          changeSetId,
          input.revisionId,
          input.revisionDigest,
          JSON.stringify(review),
          user.id,
          decidedAt,
        );
      this.database.connection
        .prepare(
          `INSERT INTO approvals(id, change_set_id, reviewer_id, decision, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(change_set_id, reviewer_id) DO UPDATE SET
             decision = excluded.decision, note = excluded.note, created_at = excluded.created_at`,
        )
        .run(reviewId, changeSetId, user.id, input.decision, input.explanation, decidedAt);
      this.persistChangeSetVersion(updated, input.explanation, user.id, decidedAt);
      this.insertStatusActivity(updated, current.status, target, actor, input.explanation, decidedAt);
    });
    return this.getDetail(projectId, changeSetId);
  }

  listActivity(projectId: string, limit: number): ActivityDto[] {
    this.assertProject(projectId);
    const rows = this.database.connection
      .prepare("SELECT * FROM activity WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(projectId, limit) as unknown as ActivityRow[];
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      actorId: row.actor_id,
      kind: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      data: JSON.parse(row.metadata_json) as unknown,
      createdAt: row.created_at,
    }));
  }

  private transitionStatus(
    projectId: string,
    changeSetId: string,
    target: ChangeSetStatus,
    explanation: string,
    user: PublicUser,
  ): ChangeSetDetailDto {
    const row = this.loadChangeSetRow(projectId, changeSetId);
    const current = this.parseStoredChangeSet(row);
    if (!canTransitionChangeSet(current.status, target)) {
      throw new HttpError(409, "invalid_transition", `Transição ${current.status} -> ${target} não permitida`);
    }
    const updatedAt = nowIso();
    const updated = parseChangeSet({ ...current, status: target, updatedAt });
    const actor = userActor(user);
    this.runInTransaction(() => {
      this.persistChangeSetVersion(updated, explanation, user.id, updatedAt);
      this.insertStatusActivity(updated, current.status, target, actor, explanation, updatedAt);
    });
    return this.getDetail(projectId, changeSetId);
  }

  private parseStoredChangeSet(row: ChangeSetRow): ChangeSet {
    return parseChangeSet(JSON.parse(row.proposal_json) as unknown);
  }

  private loadChangeSetRow(projectId: string, changeSetId: string): ChangeSetRow {
    const row = this.database.connection
      .prepare("SELECT * FROM change_sets WHERE id = ? AND project_id = ?")
      .get(changeSetId, projectId) as ChangeSetRow | undefined;
    if (!row) throw new HttpError(404, "change_set_not_found", "Conjunto de mudanças não encontrado");
    return row;
  }

  private loadCurrentProjectRevisionDigest(projectId: string): RevisionDigestMetadata {
    const row = this.database.connection
      .prepare(
        `SELECT r.id, r.project_id, r.revision_number, r.parent_revision_number,
                r.snapshot_json, r.created_at, u.id AS user_id, u.display_name, u.role
         FROM projects p
         JOIN revisions r ON r.project_id = p.id AND r.revision_number = p.latest_revision
         JOIN users u ON u.id = r.created_by
         WHERE p.id = ?`,
      )
      .get(projectId) as ProjectRevisionRow | undefined;
    if (!row) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
    const parent =
      row.parent_revision_number === null
        ? null
        : (this.database.connection
            .prepare("SELECT id FROM revisions WHERE project_id = ? AND revision_number = ?")
            .get(projectId, row.parent_revision_number) as { id: string } | undefined)?.id ?? null;
    const digest = digestCanonicalJson(JSON.parse(row.snapshot_json) as unknown);
    return {
      schemaVersion: 1,
      revisionId: row.id,
      projectId: row.project_id,
      parentRevisionId: parent,
      sequence: row.revision_number - 1,
      digestAlgorithm: "sha256",
      canonicalization: "jcs-rfc8785",
      digest: digest.digest,
      contentBytes: digest.bytes,
      createdAt: row.created_at,
      createdBy: {
        kind: "user",
        userId: row.user_id,
        displayName: row.display_name,
        role: parseWorkspaceRole(row.role),
      },
    };
  }

  private createCandidateRevisionDigest(
    projectId: string,
    base: RevisionDigestMetadata,
    title: string,
    explanation: string,
    operations: readonly ChangeOperation[],
    sourceProposalIds: readonly string[],
    actor: UserActor,
    createdAt: string,
  ): RevisionDigestMetadata {
    const content = digestCanonicalJson({
      projectId,
      baseRevisionDigest: base.digest,
      title,
      explanation,
      sourceProposalIds,
      operations,
    });
    return {
      schemaVersion: 1,
      revisionId: randomUUID(),
      projectId,
      parentRevisionId: base.revisionId,
      sequence: base.sequence + 1,
      digestAlgorithm: "sha256",
      canonicalization: "jcs-rfc8785",
      digest: content.digest,
      contentBytes: content.bytes,
      createdAt,
      createdBy: actor,
    };
  }

  private assertCandidateIdentity(changeSet: ChangeSet, revisionId: string, revisionDigest: string): void {
    if (
      !changeSet.candidateRevision ||
      changeSet.candidateRevision.revisionId !== revisionId ||
      changeSet.candidateRevision.digest !== revisionDigest
    ) {
      throw new HttpError(409, "candidate_mismatch", "A revisão informada não é a candidata atual");
    }
  }

  private buildSandboxTestRecord(input: RecordSandboxTestInput, actor: UserActor): SandboxTestRecord {
    const started = Date.parse(input.startedAt);
    const completed = Date.parse(input.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed - started > MAXIMUM_TEST_DURATION_MS) {
      throw new HttpError(400, "invalid_test_time", "Janela de execução do teste inválida");
    }
    if (completed > Date.now() + ALLOWED_CLOCK_SKEW_MS) {
      throw new HttpError(400, "invalid_test_time", "O teste não pode terminar no futuro");
    }
    return parseSandboxTest({
      testRunId: randomUUID(),
      revisionId: input.revisionId,
      revisionDigest: input.revisionDigest,
      status: input.status,
      checks: input.checks.map((check) => ({
        checkId: check.checkId ?? randomUUID(),
        name: check.name,
        status: check.status,
        details: check.details,
      })),
      executedBy: actor,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    });
  }

  private resolveReviewTargetStatus(
    changeSet: ChangeSet,
    input: ReviewChangeSetInput,
    user: PublicUser,
  ): ChangeSetStatus {
    if (input.decision === "request-changes") return "changes-requested";
    if (input.decision === "reject") return "rejected";
    if (user.role !== "owner") {
      throw new HttpError(403, "owner_required", "Somente o dono pode aprovar");
    }
    if (
      changeSet.latestTest?.status !== "passed" ||
      changeSet.latestTest.revisionId !== input.revisionId ||
      changeSet.latestTest.revisionDigest !== input.revisionDigest
    ) {
      throw new HttpError(409, "passing_test_required", "A revisão exata precisa de um teste aprovado");
    }
    return "approved";
  }

  private assertBaseRevisionIsCurrent(changeSet: ChangeSet): void {
    const current = this.loadCurrentProjectRevisionDigest(changeSet.projectId);
    if (
      current.revisionId !== changeSet.baseRevision.revisionId ||
      current.digest !== changeSet.baseRevision.digest
    ) {
      throw new HttpError(409, "stale_base_revision", "O projeto mudou; recrie a proposta sobre a revisão atual");
    }
  }

  private assertStoredChangeSetWasNotChanged(previousRow: ChangeSetRow): void {
    const currentRow = this.loadChangeSetRow(previousRow.project_id, previousRow.id);
    if (currentRow.proposal_json !== previousRow.proposal_json) {
      throw new HttpError(409, "change_set_conflict", "O conjunto mudou durante a revisão; recarregue antes de decidir");
    }
  }

  private persistChangeSetVersion(changeSet: ChangeSet, reason: string, userId: string, createdAt: string): void {
    this.database.connection
      .prepare(
        `UPDATE change_sets SET title = ?, explanation = ?, status = ?, proposal_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changeSet.title,
        changeSet.explanation,
        changeSet.status,
        JSON.stringify(changeSet),
        createdAt,
        changeSet.changeSetId,
      );
    this.appendImmutableVersion(changeSet, reason, userId, createdAt);
  }

  private appendImmutableVersion(changeSet: ChangeSet, reason: string, userId: string, createdAt: string): void {
    const currentVersion = this.loadLatestVersion(changeSet.changeSetId);
    this.database.connection
      .prepare(
        `INSERT INTO change_set_versions(
           id, change_set_id, version, document_json, reason, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        changeSet.changeSetId,
        currentVersion + 1,
        JSON.stringify(changeSet),
        reason,
        userId,
        createdAt,
      );
  }

  private loadLatestVersion(changeSetId: string): number {
    const result = this.database.connection
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM change_set_versions WHERE change_set_id = ?")
      .get(changeSetId) as { version: number };
    return result.version;
  }

  private insertRevisionActivity(
    changeSet: ChangeSet,
    revision: RevisionDigestMetadata,
    actor: UserActor,
    explanation: string,
    occurredAt: string,
  ): void {
    const event = parseActivity({
      schemaVersion: 1,
      eventId: randomUUID(),
      workspaceId: changeSet.workspaceId,
      projectId: changeSet.projectId,
      actor,
      occurredAt,
      kind: "revision.created",
      revision,
      explanation,
    });
    this.insertContractActivity(event, "change_set", changeSet.changeSetId);
  }

  private insertStatusActivity(
    changeSet: ChangeSet,
    fromStatus: ChangeSetStatus,
    toStatus: ChangeSetStatus,
    actor: UserActor,
    explanation: string,
    occurredAt: string,
  ): void {
    const event = parseActivity({
      schemaVersion: 1,
      eventId: randomUUID(),
      workspaceId: changeSet.workspaceId,
      projectId: changeSet.projectId,
      actor,
      occurredAt,
      kind: "change-set.status-changed",
      changeSetId: changeSet.changeSetId,
      fromStatus,
      toStatus,
      explanation,
    });
    this.insertContractActivity(event, "change_set", changeSet.changeSetId);
  }

  private insertContractActivity(event: ActivityEvent, entityType: string, entityId: string): void {
    this.database.connection
      .prepare(
        `INSERT INTO activity(
           id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.projectId,
        event.actor.kind === "user" ? event.actor.userId : null,
        event.kind,
        entityType,
        entityId,
        JSON.stringify(event),
        event.occurredAt,
      );
  }

  private insertGenericActivity(
    projectId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): void {
    this.database.connection
      .prepare(
        `INSERT INTO activity(
           id, project_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), projectId, actorId, action, entityType, entityId, JSON.stringify(metadata), nowIso());
  }

  private runInTransaction<T>(operation: () => T): T {
    this.database.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
  }

  private assertProject(projectId: string): void {
    if (!this.database.getProject(projectId)) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
  }

  private requireEditor(user: PublicUser): void {
    if (user.role !== "owner" && user.role !== "editor") {
      throw new HttpError(403, "editor_required", "Permissão de edição necessária");
    }
  }
}
