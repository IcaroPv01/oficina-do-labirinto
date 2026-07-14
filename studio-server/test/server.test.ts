import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { WebSocket } from "ws";
import { loadConfig } from "../src/config.js";
import { createStudioServer, type VerbooGateway } from "../src/server.js";

const origin = "http://localhost:5173";

const fakeVerboo: VerbooGateway = {
  configured: true,
  async listModels() {
    return [{ id: "verboo-test" }];
  },
  async advisoryChat(messages, model) {
    return { model: model ?? "verboo-test", content: `Conselho: ${messages.at(-1)?.content ?? ""}` };
  },
  async proposeChange(_prompt, model) {
    return {
      provider: "verboo",
      model: model ?? "verboo-test",
      requestId: "provider-request-001",
      candidate: {
        title: "Ajustar velocidade",
        explanation: "Candidato estruturado ainda não aplicado.",
        risks: ["Pode alterar o ritmo do jogo."],
        operations: [
          {
            operationId: "operation-speed",
            kind: "player.set-tuning",
            explanation: "Aumenta a velocidade dentro do limite.",
            tuning: { speed: 220 },
          },
        ],
      },
    };
  },
};

test("HTTP, optimistic snapshots, chat, advisory AI and WebSocket presence work together", async () => {
  const config = loadConfig({
    STUDIO_HOST: "127.0.0.1",
    STUDIO_PORT: "0",
    STUDIO_DATABASE_PATH: ":memory:",
    STUDIO_CORS_ORIGINS: origin,
    STUDIO_COOKIE_SECURE: "false",
    STUDIO_COOKIE_SAME_SITE: "lax",
    STUDIO_DEV_AUTH_ENABLED: "true",
    VERBOO_API_KEY: "test-server-only-key",
  });
  const studio = createStudioServer(config, { verboo: fakeVerboo });
  const address = await studio.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let socket: WebSocket | undefined;

  try {
    const denied = await fetch(`${baseUrl}/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(denied.status, 403);

    const health = await fetch(`${baseUrl}/health`, { headers: { origin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origin);

    const login = await jsonRequest(`${baseUrl}/auth/dev`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Icaro" }),
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    assert.match(login.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.doesNotMatch(JSON.stringify(login.body), /sessionToken|api[_-]?key|vbk_/i);
    const csrf = (login.body as { csrfToken: string }).csrfToken;

    const created = await jsonRequest(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ name: "Labirinto", explanation: "Importação inicial", snapshot: { version: 1 } }),
    });
    assert.equal(created.response.status, 201);
    const projectId = (created.body as { project: { id: string } }).project.id;

    const updated = await jsonRequest(`${baseUrl}/api/projects/${projectId}/snapshot`, {
      method: "PUT",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ baseRevision: 1, explanation: "Movimento ajustado", snapshot: { version: 2 } }),
    });
    assert.equal(updated.response.status, 200);
    const conflict = await jsonRequest(`${baseUrl}/api/projects/${projectId}/snapshot`, {
      method: "PUT",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ baseRevision: 1, explanation: "Edição antiga", snapshot: { version: 3 } }),
    });
    assert.equal(conflict.response.status, 409);

    const posted = await jsonRequest(`${baseUrl}/api/projects/${projectId}/chat`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ body: "Explicação compartilhada" }),
    });
    assert.equal(posted.response.status, 201);
    const history = await jsonRequest(`${baseUrl}/api/projects/${projectId}/chat`, {
      headers: { origin, cookie },
    });
    assert.equal((history.body as { messages: unknown[] }).messages.length, 1);

    const models = await jsonRequest(`${baseUrl}/api/ai/models`, { headers: { origin, cookie } });
    assert.deepEqual((models.body as { models: unknown[] }).models, [{ id: "verboo-test" }]);
    const advisory = await jsonRequest(`${baseUrl}/api/ai/chat`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ model: "verboo-test", messages: [{ role: "user", content: "Explique a sala" }] }),
    });
    assert.equal((advisory.body as { applied: boolean }).applied, false);
    const prompt = "Aumente a velocidade";
    const proposal = await jsonRequest(`${baseUrl}/api/ai/propose`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ projectId, model: "verboo-test", prompt }),
    });
    assert.equal(proposal.response.status, 200);
    const proposalPayload = proposal.body as {
      mode: string;
      applied: boolean;
      proposalId: string;
      projectId: string;
      createdAt: string;
      promptDigest: string;
      author: { id: string; displayName: string; role: string };
      provider: string;
      model: string;
      requestId: string | null;
      candidate: { operations: Array<{ kind: string }>; risks: string[] };
    };
    assert.deepEqual(
      {
        mode: proposalPayload.mode,
        applied: proposalPayload.applied,
        projectId: proposalPayload.projectId,
        promptDigest: proposalPayload.promptDigest,
        author: proposalPayload.author,
        provider: proposalPayload.provider,
        model: proposalPayload.model,
        requestId: proposalPayload.requestId,
        kind: proposalPayload.candidate.operations[0]?.kind,
        risks: proposalPayload.candidate.risks,
      },
      {
        mode: "proposal",
        applied: false,
        projectId,
        promptDigest: createHash("sha256").update(prompt, "utf8").digest("hex"),
        author: { id: "dev-local-owner", displayName: "Icaro", role: "owner" },
        provider: "verboo",
        model: "verboo-test",
        requestId: "provider-request-001",
        kind: "player.set-tuning",
        risks: ["Pode alterar o ritmo do jogo."],
      },
    );
    assert.match(proposalPayload.proposalId, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(proposalPayload.createdAt)));
    assert.doesNotMatch(JSON.stringify(proposal.body), new RegExp(`${prompt}|test-server-only-key`, "i"));

    const proposalActivity = await jsonRequest(`${baseUrl}/api/projects/${projectId}/activity`, {
      headers: { origin, cookie },
    });
    const auditEvent = (proposalActivity.body as {
      activity: Array<{
        kind: string;
        entityType: string;
        entityId: string | null;
        data: Record<string, unknown>;
      }>;
    }).activity.find((event) => event.entityId === proposalPayload.proposalId);
    assert.ok(auditEvent);
    assert.equal(auditEvent.kind, "ai-proposal.created");
    assert.equal(auditEvent.entityType, "ai-proposal");
    assert.equal(auditEvent.data.promptDigest, proposalPayload.promptDigest);
    assert.deepEqual(auditEvent.data.author, proposalPayload.author);
    assert.equal(auditEvent.data.provider, "verboo");
    assert.equal(auditEvent.data.model, "verboo-test");
    assert.equal(auditEvent.data.requestId, "provider-request-001");
    assert.doesNotMatch(JSON.stringify(auditEvent), new RegExp(`${prompt}|test-server-only-key`, "i"));
    const changeSetsAfterProposal = await jsonRequest(
      `${baseUrl}/api/projects/${projectId}/change-sets`,
      { headers: { origin, cookie } },
    );
    assert.deepEqual((changeSetsAfterProposal.body as { changeSets: unknown[] }).changeSets, []);

    const linkedChangeSet = await jsonRequest(`${baseUrl}/api/projects/${projectId}/change-sets`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({
        title: "Ajustar velocidade",
        explanation: "Usuário adicionou a candidata da IA ao fluxo de revisão.",
        operations: proposalPayload.candidate.operations,
        sourceProposalIds: [proposalPayload.proposalId],
      }),
    });
    assert.equal(linkedChangeSet.response.status, 201);
    assert.deepEqual(
      (linkedChangeSet.body as { changeSet: { sourceProposalIds: string[] } }).changeSet.sourceProposalIds,
      [proposalPayload.proposalId],
    );

    socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?projectId=${projectId}`, {
      headers: { Origin: origin, Cookie: cookie },
    });
    const ready = await nextSocketMessage(socket);
    assert.equal((ready as { type: string }).type, "ready");
    socket.send(JSON.stringify({ type: "chat.send", csrfToken: csrf, body: "Mensagem em tempo real" }));
    const broadcast = await nextSocketMessage(socket);
    assert.equal((broadcast as { type: string }).type, "chat.created");
  } finally {
    socket?.close();
    await studio.close();
  }
});

test("structured AI proposals reject unknown projects and read-only roles before calling the provider", async () => {
  let providerCalls = 0;
  const permissionGateway: VerbooGateway = {
    ...fakeVerboo,
    async proposeChange(prompt, model) {
      providerCalls += 1;
      return fakeVerboo.proposeChange(prompt, model);
    },
  };
  const config = loadConfig({
    STUDIO_HOST: "127.0.0.1",
    STUDIO_PORT: "0",
    STUDIO_DATABASE_PATH: ":memory:",
    STUDIO_CORS_ORIGINS: origin,
    STUDIO_COOKIE_SECURE: "false",
    STUDIO_COOKIE_SAME_SITE: "lax",
    STUDIO_DEV_AUTH_ENABLED: "true",
  });
  const studio = createStudioServer(config, { verboo: permissionGateway });
  const address = await studio.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const ownerLogin = await jsonRequest(`${baseUrl}/auth/dev`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Icaro" }),
    });
    const ownerCookie = ownerLogin.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const ownerCsrf = (ownerLogin.body as { csrfToken: string }).csrfToken;
    const project = await jsonRequest(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders(ownerCookie, ownerCsrf),
      body: JSON.stringify({ name: "Labirinto", explanation: "Projeto inicial", snapshot: { version: 1 } }),
    });
    const projectId = (project.body as { project: { id: string } }).project.id;

    const missingProjectId = await jsonRequest(`${baseUrl}/api/ai/propose`, {
      method: "POST",
      headers: authHeaders(ownerCookie, ownerCsrf),
      body: JSON.stringify({ prompt: "Ajuste seguro", model: "verboo-test" }),
    });
    assert.equal(missingProjectId.response.status, 400);
    assert.equal((missingProjectId.body as { error: { code: string } }).error.code, "invalid_field");

    const unknownProject = await jsonRequest(`${baseUrl}/api/ai/propose`, {
      method: "POST",
      headers: authHeaders(ownerCookie, ownerCsrf),
      body: JSON.stringify({ projectId: "missing-project", prompt: "Ajuste seguro", model: "verboo-test" }),
    });
    assert.equal(unknownProject.response.status, 404);
    assert.equal((unknownProject.body as { error: { code: string } }).error.code, "project_not_found");
    assert.equal(providerCalls, 0);

    for (const role of ["reviewer", "viewer"] as const) {
      const invite = studio.database.createInvite(role, null, 60_000);
      const login = await jsonRequest(`${baseUrl}/auth/invites/redeem`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ token: invite.token, displayName: role }),
      });
      const cookie = login.response.headers.get("set-cookie")!.split(";", 1)[0]!;
      const csrf = (login.body as { csrfToken: string }).csrfToken;
      const denied = await jsonRequest(`${baseUrl}/api/ai/propose`, {
        method: "POST",
        headers: authHeaders(cookie, csrf),
        body: JSON.stringify({ projectId, prompt: "Ajuste seguro", model: "verboo-test" }),
      });
      assert.equal(denied.response.status, 403);
      assert.equal((denied.body as { error: { code: string } }).error.code, "editor_required");
    }
    assert.equal(providerCalls, 0);
  } finally {
    await studio.close();
  }
});

function authHeaders(cookie: string, csrf: string): Record<string, string> {
  return { origin, cookie, "x-studio-csrf": csrf, "content-type": "application/json" };
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, init);
  return { response, body: (await response.json()) as unknown };
}

async function nextSocketMessage(socket: WebSocket): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket timeout")), 2_000);
    socket.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()) as unknown);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
