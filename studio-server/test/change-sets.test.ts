import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical-json.js";
import { ChangeSetService } from "../src/change-sets.js";
import { StudioDatabase } from "../src/database.js";

const speedOperation = {
  operationId: "operation-speed-1",
  kind: "enemy.set-tuning",
  explanation: "Deixa os inimigos um pouco mais ágeis.",
  tuning: { speed: 110 },
} as const;

test("canonical JSON is stable across object insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: [true, { y: 2, x: 1 }] }), canonicalJson({ a: [true, { x: 1, y: 2 }], z: 1 }));
});

test("safe change-set lifecycle requires the exact passing candidate before owner approval", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const owner = database.createDevSession("Icaro", 60_000).user;
    const project = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", owner).project;
    const service = new ChangeSetService(database);
    const created = service.create(
      project.id,
      {
        title: "Inimigo mais rápido",
        explanation: "Aumenta a pressão sem inserir código arbitrário.",
        operations: [speedOperation],
      },
      owner,
    );
    const candidate = created.changeSet.candidateRevision;
    assert.ok(candidate);
    assert.equal(created.changeSet.status, "draft");

    assert.throws(
      () => service.markTesting(project.id, created.changeSet.changeSetId, "Pular revisão", owner),
      /draft -> testing não permitida/,
    );
    service.markReady(project.id, created.changeSet.changeSetId, "Pronto para testar", owner);
    service.markTesting(project.id, created.changeSet.changeSetId, "Teste iniciado", owner);
    assert.throws(
      () =>
        service.recordTest(
          project.id,
          created.changeSet.changeSetId,
          passingTestInput(candidate.revisionId, "0".repeat(64)),
          owner,
        ),
      /não é a candidata atual/,
    );

    service.recordTest(
      project.id,
      created.changeSet.changeSetId,
      {
        ...passingTestInput(candidate.revisionId, candidate.digest),
        status: "failed",
        checks: [{ name: "Movimento", status: "failed", details: "Colidiu com a parede" }],
      },
      owner,
    );
    assert.throws(
      () =>
        service.review(
          project.id,
          created.changeSet.changeSetId,
          reviewInput("approve", candidate.revisionId, candidate.digest),
          owner,
        ),
      /teste aprovado/,
    );

    service.recordTest(
      project.id,
      created.changeSet.changeSetId,
      passingTestInput(candidate.revisionId, candidate.digest),
      owner,
    );
    const approved = service.review(
      project.id,
      created.changeSet.changeSetId,
      reviewInput("approve", candidate.revisionId, candidate.digest),
      owner,
    );
    assert.equal(approved.changeSet.status, "approved");
    assert.equal(approved.changeSet.review?.decision, "approve");
    assert.equal(approved.changeSet.review?.revisionId, candidate.revisionId);
    assert.equal(approved.changeSet.review?.revisionDigest, candidate.digest);
    assert.equal(approved.testRuns.length, 2, "test runs remain immutable");
    assert.equal(approved.reviews.length, 1);
    assert.ok(approved.history.length >= 6);
    assert.throws(
      () => database.connection.prepare("UPDATE sandbox_tests SET revision_digest = ?").run("a".repeat(64)),
      /sandbox_tests is immutable/,
    );
    assert.throws(
      () => database.connection.prepare("DELETE FROM change_set_reviews").run(),
      /change_set_reviews is immutable/,
    );
    assert.throws(
      () =>
        service.edit(
          project.id,
          created.changeSet.changeSetId,
          { baseVersion: approved.version, title: "Alteração indevida", reason: "Tentativa após aprovação" },
          owner,
        ),
      /Solicite alterações/,
    );
  } finally {
    database.close();
  }
});

test("editing after requested changes creates a new candidate and invalidates test and approval", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const owner = database.createDevSession("Icaro", 60_000).user;
    const project = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", owner).project;
    const service = new ChangeSetService(database);
    const created = service.create(
      project.id,
      { title: "Velocidade", explanation: "Primeira proposta", operations: [speedOperation] },
      owner,
    );
    const firstCandidate = created.changeSet.candidateRevision!;
    service.markReady(project.id, created.changeSet.changeSetId, "Pronto", owner);
    service.markTesting(project.id, created.changeSet.changeSetId, "Em teste", owner);
    service.recordTest(
      project.id,
      created.changeSet.changeSetId,
      passingTestInput(firstCandidate.revisionId, firstCandidate.digest),
      owner,
    );
    const requested = service.review(
      project.id,
      created.changeSet.changeSetId,
      reviewInput("request-changes", firstCandidate.revisionId, firstCandidate.digest),
      owner,
    );

    const edited = service.edit(
      project.id,
      created.changeSet.changeSetId,
      {
        baseVersion: requested.version,
        explanation: "Velocidade reduzida após o teste.",
        operations: [{ ...speedOperation, tuning: { speed: 95 } }],
        reason: "Corrige a dificuldade observada no sandbox.",
      },
      owner,
    );
    assert.equal(edited.changeSet.status, "draft");
    assert.notEqual(edited.changeSet.candidateRevision?.revisionId, firstCandidate.revisionId);
    assert.notEqual(edited.changeSet.candidateRevision?.digest, firstCandidate.digest);
    assert.equal(edited.changeSet.latestTest, null);
    assert.equal(edited.changeSet.review, null);
    assert.equal(edited.testRuns.length, 1, "old test stays in immutable audit history");
    assert.equal(edited.reviews.length, 1, "old review stays in immutable audit history");
    assert.throws(
      () =>
        service.edit(
          project.id,
          created.changeSet.changeSetId,
          { baseVersion: requested.version, title: "Edição concorrente", reason: "Base antiga" },
          owner,
        ),
      /avançou para a versão/,
    );
  } finally {
    database.close();
  }
});

test("approval is blocked when the published project moved beyond the proposal base", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const owner = database.createDevSession("Icaro", 60_000).user;
    const project = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", owner).project;
    const service = new ChangeSetService(database);
    const created = service.create(
      project.id,
      { title: "Velocidade", explanation: "Proposta concorrente", operations: [speedOperation] },
      owner,
    );
    const candidate = created.changeSet.candidateRevision!;
    service.markReady(project.id, created.changeSet.changeSetId, "Pronto", owner);
    service.markTesting(project.id, created.changeSet.changeSetId, "Em teste", owner);
    service.recordTest(
      project.id,
      created.changeSet.changeSetId,
      passingTestInput(candidate.revisionId, candidate.digest),
      owner,
    );
    database.updateSnapshot(project.id, 1, { version: 2 }, "Outra mudança entrou primeiro", owner);

    assert.throws(
      () =>
        service.review(
          project.id,
          created.changeSet.changeSetId,
          reviewInput("approve", candidate.revisionId, candidate.digest),
          owner,
        ),
      /projeto mudou/i,
    );
  } finally {
    database.close();
  }
});

test("reviewers can request changes or reject but cannot approve for the owner", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const owner = database.createDevSession("Icaro", 60_000).user;
    const reviewerInvite = database.createInvite("reviewer", owner.id, 60_000);
    const reviewer = database.redeemInvite(reviewerInvite.token, "Amigo", 60_000).user;
    const project = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", owner).project;
    const service = new ChangeSetService(database);
    const created = service.create(
      project.id,
      { title: "Velocidade", explanation: "Revisão por outra pessoa", operations: [speedOperation] },
      owner,
    );
    const candidate = created.changeSet.candidateRevision!;
    service.markReady(project.id, created.changeSet.changeSetId, "Pronto", owner);
    service.markTesting(project.id, created.changeSet.changeSetId, "Em teste", reviewer);
    service.recordTest(
      project.id,
      created.changeSet.changeSetId,
      passingTestInput(candidate.revisionId, candidate.digest),
      reviewer,
    );
    assert.throws(
      () =>
        service.review(
          project.id,
          created.changeSet.changeSetId,
          reviewInput("approve", candidate.revisionId, candidate.digest),
          reviewer,
        ),
      /Somente o dono/,
    );
    const requested = service.review(
      project.id,
      created.changeSet.changeSetId,
      reviewInput("request-changes", candidate.revisionId, candidate.digest),
      reviewer,
    );
    assert.equal(requested.changeSet.status, "changes-requested");

    const rejectedCandidate = service.create(
      project.id,
      { title: "Outra velocidade", explanation: "Pode ser rejeitada antes do teste", operations: [speedOperation] },
      owner,
    );
    const exactCandidate = rejectedCandidate.changeSet.candidateRevision!;
    service.markReady(project.id, rejectedCandidate.changeSet.changeSetId, "Pronto", owner);
    const rejected = service.review(
      project.id,
      rejectedCandidate.changeSet.changeSetId,
      reviewInput("reject", exactCandidate.revisionId, exactCandidate.digest),
      reviewer,
    );
    assert.equal(rejected.changeSet.status, "rejected");
  } finally {
    database.close();
  }
});

test("contracts reject arbitrary code operations before persistence", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const owner = database.createDevSession("Icaro", 60_000).user;
    const project = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", owner).project;
    const service = new ChangeSetService(database);
    assert.throws(
      () =>
        service.create(
          project.id,
          {
            title: "Executar código",
            explanation: "Isto deve ser rejeitado.",
            operations: [{ operationId: "operation-code-1", kind: "code.run", explanation: "shell" }],
          },
          owner,
        ),
      /operations inválido/,
    );
    assert.equal(service.list(project.id).length, 0);
  } finally {
    database.close();
  }
});

function passingTestInput(revisionId: string, revisionDigest: string) {
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.parse(completedAt) - 1_000).toISOString();
  return {
    revisionId,
    revisionDigest,
    status: "passed" as const,
    checks: [{ name: "Movimento", status: "passed" as const, details: null }],
    startedAt,
    completedAt,
  };
}

function reviewInput(
  decision: "approve" | "request-changes" | "reject",
  revisionId: string,
  revisionDigest: string,
) {
  return { decision, revisionId, revisionDigest, explanation: "Decisão registrada após inspeção manual." };
}
