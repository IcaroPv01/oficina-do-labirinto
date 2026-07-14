import assert from "node:assert/strict";
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
