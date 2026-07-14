import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createStudioServer } from "../src/server.js";

const browserOrigin = "http://localhost:5173";

test("change-set HTTP API exposes structured candidate, sandbox result, audit and exact owner approval", async () => {
  const config = loadConfig({
    STUDIO_HOST: "127.0.0.1",
    STUDIO_PORT: "0",
    STUDIO_DATABASE_PATH: ":memory:",
    STUDIO_CORS_ORIGINS: browserOrigin,
    STUDIO_COOKIE_SECURE: "false",
    STUDIO_COOKIE_SAME_SITE: "lax",
    STUDIO_DEV_AUTH_ENABLED: "true",
  });
  const studio = createStudioServer(config);
  const address = await studio.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const login = await requestJson(`${baseUrl}/auth/dev`, {
      method: "POST",
      headers: { origin: browserOrigin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Icaro" }),
    });
    const cookie = login.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const csrf = (login.body as { csrfToken: string }).csrfToken;
    const headers = {
      origin: browserOrigin,
      cookie,
      "x-studio-csrf": csrf,
      "content-type": "application/json",
    };
    const projectResponse = await requestJson(`${baseUrl}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Labirinto", explanation: "Projeto inicial", snapshot: { version: 1 } }),
    });
    const projectId = (projectResponse.body as { project: { id: string } }).project.id;

    const createdResponse = await requestJson(`${baseUrl}/api/projects/${projectId}/change-sets`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Ajuste do jogador",
        explanation: "Movimento um pouco mais rápido.",
        operations: [
          {
            operationId: "operation-player-speed",
            kind: "player.set-tuning",
            explanation: "Aumenta a velocidade com limite validado.",
            tuning: { speed: 220 },
          },
        ],
      }),
    });
    assert.equal(createdResponse.response.status, 201);
    const created = createdResponse.body as {
      changeSet: { changeSetId: string; candidateRevision: { revisionId: string; digest: string }; status: string };
      version: number;
    };
    assert.equal(created.changeSet.status, "draft");
    assert.match(created.changeSet.candidateRevision.digest, /^[0-9a-f]{64}$/);

    const patchedResponse = await requestJson(
      `${baseUrl}/api/projects/${projectId}/change-sets/${created.changeSet.changeSetId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          baseVersion: created.version,
          reason: "Explica o ajuste antes do teste.",
          explanation: "Movimento refinado após revisão da proposta.",
        }),
      },
    );
    const patched = patchedResponse.body as typeof created;
    assert.equal(patchedResponse.response.status, 200);
    assert.equal(patched.version, 2);
    assert.notEqual(patched.changeSet.candidateRevision.digest, created.changeSet.candidateRevision.digest);
    const candidate = patched.changeSet.candidateRevision;

    const ready = await postAction(baseUrl, projectId, created.changeSet.changeSetId, "ready", headers, {
      explanation: "Pronto para revisão.",
    });
    assert.equal((ready.body as { changeSet: { status: string } }).changeSet.status, "proposed");
    const testing = await postAction(baseUrl, projectId, created.changeSet.changeSetId, "testing", headers, {
      explanation: "Teste manual iniciado.",
    });
    assert.equal((testing.body as { changeSet: { status: string } }).changeSet.status, "testing");

    const completedAt = new Date().toISOString();
    const testResponse = await postAction(baseUrl, projectId, created.changeSet.changeSetId, "tests", headers, {
      revisionId: candidate.revisionId,
      revisionDigest: candidate.digest,
      status: "passed",
      checks: [{ name: "Movimento e colisão", status: "passed", details: null }],
      startedAt: new Date(Date.parse(completedAt) - 1_000).toISOString(),
      completedAt,
    });
    assert.equal(testResponse.response.status, 201);

    const wrongApproval = await postAction(baseUrl, projectId, created.changeSet.changeSetId, "review", headers, {
      decision: "approve",
      revisionId: candidate.revisionId,
      revisionDigest: "f".repeat(64),
      explanation: "Digest errado deve falhar.",
    });
    assert.equal(wrongApproval.response.status, 409);

    const approvedResponse = await postAction(
      baseUrl,
      projectId,
      created.changeSet.changeSetId,
      "review",
      headers,
      {
        decision: "approve",
        revisionId: candidate.revisionId,
        revisionDigest: candidate.digest,
        explanation: "Teste manual aprovado pelo dono.",
      },
    );
    const approved = approvedResponse.body as {
      changeSet: {
        status: string;
        review: { decision: string; revisionId: string; revisionDigest: string };
      };
      testRuns: unknown[];
      reviews: unknown[];
      history: unknown[];
    };
    assert.equal(approved.changeSet.status, "approved");
    assert.equal(approved.changeSet.review.decision, "approve");
    assert.equal(approved.changeSet.review.revisionId, candidate.revisionId);
    assert.equal(approved.changeSet.review.revisionDigest, candidate.digest);
    assert.equal(approved.testRuns.length, 1);
    assert.equal(approved.reviews.length, 1);
    assert.ok(approved.history.length >= 5);

    const list = await requestJson(`${baseUrl}/api/projects/${projectId}/change-sets`, {
      headers: { origin: browserOrigin, cookie },
    });
    assert.equal((list.body as { changeSets: unknown[] }).changeSets.length, 1);
    const activity = await requestJson(`${baseUrl}/api/projects/${projectId}/activity`, {
      headers: { origin: browserOrigin, cookie },
    });
    assert.ok((activity.body as { activity: Array<{ kind: string }> }).activity.some((event) => event.kind === "test.recorded"));
  } finally {
    await studio.close();
  }
});

async function postAction(
  baseUrl: string,
  projectId: string,
  changeSetId: string,
  action: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return await requestJson(`${baseUrl}/api/projects/${projectId}/change-sets/${changeSetId}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function requestJson(url: string, init: RequestInit): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, init);
  return { response, body: (await response.json()) as unknown };
}
