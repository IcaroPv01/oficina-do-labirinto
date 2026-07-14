import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  authenticate,
  clearSessionCookie,
  isLoopbackSocket,
  requireCsrf,
  requireSession,
  sessionTokenFromRequest,
  setSessionCookie,
} from "./auth.js";
import type { StudioConfig } from "./config.js";
import {
  ChangeSetService,
  type RecordSandboxTestInput,
  type ReviewChangeSetInput,
  type SandboxCheckInput,
} from "./change-sets.js";
import { canCreateInvite, canEdit, parseWorkspaceRole } from "./contracts.js";
import { StudioDatabase } from "./database.js";
import { HttpError } from "./errors.js";
import { logger } from "./logger.js";
import { ConcurrencyGate, FixedWindowRateLimiter } from "./rate-limit.js";
import { integerField, opaqueId, optionalStringField, plainJsonObject, record, stringField } from "./validation.js";
import { VerbooClient, type AdvisoryMessage } from "./verboo.js";
import { StudioWebSocketHub } from "./ws-hub.js";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export interface RunningStudioServer {
  readonly httpServer: Server;
  readonly database: StudioDatabase;
  readonly hub: StudioWebSocketHub;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export interface ServerDependencies {
  readonly database?: StudioDatabase;
  readonly verboo?: VerbooGateway;
}

export interface VerbooGateway {
  readonly configured: boolean;
  listModels(): ReturnType<VerbooClient["listModels"]>;
  advisoryChat(...parameters: Parameters<VerbooClient["advisoryChat"]>): ReturnType<VerbooClient["advisoryChat"]>;
  proposeChange(...parameters: Parameters<VerbooClient["proposeChange"]>): ReturnType<VerbooClient["proposeChange"]>;
}

interface RouteContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
}

export function createStudioServer(config: StudioConfig, dependencies: ServerDependencies = {}): RunningStudioServer {
  const database = dependencies.database ?? new StudioDatabase(config.databasePath);
  const ownsDatabase = !dependencies.database;
  const verboo = dependencies.verboo ?? new VerbooClient(config);
  const changeSets = new ChangeSetService(database);
  const authRate = new FixedWindowRateLimiter(12, 15 * 60_000, "Muitas tentativas de autenticação");
  const writeRate = new FixedWindowRateLimiter(120, 60_000, "Muitas alterações em pouco tempo");
  const chatRate = new FixedWindowRateLimiter(30, 60_000, "Muitas mensagens de chat");
  const aiRate = new FixedWindowRateLimiter(20, 60_000, "Muitas solicitações à IA");
  const aiGate = new ConcurrencyGate();

  const httpServer = createServer((request, response) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

    void dispatch(request, response)
      .catch((error: unknown) => handleError(response, error, requestId))
      .finally(() => {
        logger.info("http_request", {
          requestId,
          method: request.method,
          path: safePath(request.url),
          status: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        });
      });
  });
  httpServer.keepAliveTimeout = 10_000;
  httpServer.headersTimeout = 15_000;
  httpServer.requestTimeout = 60_000;
  httpServer.maxHeadersCount = 64;
  httpServer.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  const hub = new StudioWebSocketHub(httpServer, database, config);
  let listening = false;

  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applyCors(request, response, config);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://studio.invalid");
    const context: RouteContext = { request, response, url };

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "oficina-studio-server",
        aiConfigured: verboo.configured,
        now: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/invites/redeem") {
      authRate.assertAllowed(remoteKey(request));
      const body = record(await readJson(request, config.maxJsonBytes));
      const token = stringField(body, "token", { min: 20, max: 200 });
      const displayName = stringField(body, "displayName", { max: 80 });
      const session = database.redeemInvite(token, displayName, config.sessionTtlMs);
      setSessionCookie(response, session, config);
      sendJson(response, 200, sessionResponse(session));
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/dev") {
      authRate.assertAllowed(remoteKey(request));
      if (!config.devAuthEnabled || !isLoopbackSocket(request.socket)) {
        throw new HttpError(404, "not_found", "Rota não encontrada");
      }
      const body = record(await readJson(request, config.maxJsonBytes));
      const displayName = stringField(body, "displayName", { max: 80 });
      const session = database.createDevSession(displayName, config.sessionTtlMs);
      setSessionCookie(response, session, config);
      sendJson(response, 200, sessionResponse(session));
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      const principal = authenticate(request, database, config);
      if (!principal) throw new HttpError(401, "authentication_required", "Autenticação necessária");
      sendJson(response, 200, sessionResponse(principal));
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const principal = requireSession(request, database, config);
      requireCsrf(request, principal);
      const token = sessionTokenFromRequest(request, config);
      if (token) database.deleteSession(token);
      clearSessionCookie(response, config);
      response.writeHead(204).end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/invites") {
      const principal = requireMutationSession(context, database, config, writeRate);
      if (!canCreateInvite(principal.user.role)) {
        throw new HttpError(403, "owner_required", "Somente o proprietário pode criar convites");
      }
      const body = record(await readJson(request, config.maxJsonBytes));
      const role = parseWorkspaceRole(body.role);
      const invite = database.createInvite(role, principal.user.id, config.inviteTtlMs);
      sendJson(response, 201, { invite: invite.value, token: invite.token });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/projects") {
      requireSession(request, database, config);
      sendJson(response, 200, { projects: database.listProjects() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const principal = requireMutationSession(context, database, config, writeRate);
      if (!canEdit(principal.user.role)) throw new HttpError(403, "editor_required", "Permissão de edição necessária");
      const body = record(await readJson(request, config.maxSnapshotBytes + config.maxJsonBytes));
      const name = stringField(body, "name", { max: 120 });
      const explanation = stringField(body, "explanation", { max: 2_000 });
      const snapshot = plainJsonObject(body.snapshot, "snapshot");
      assertSerializedSize(snapshot, config.maxSnapshotBytes);
      const created = database.createProject(name, snapshot, explanation, principal.user);
      sendJson(response, 201, created);
      return;
    }

    const snapshotMatch = /^\/api\/projects\/([^/]+)\/snapshot$/.exec(url.pathname);
    if (snapshotMatch) {
      const projectId = opaqueId(snapshotMatch[1] ?? "", "projectId");
      if (request.method === "GET") {
        requireSession(request, database, config);
        const project = database.getProject(projectId);
        const revision = database.getLatestRevision(projectId);
        if (!project || !revision) throw new HttpError(404, "project_not_found", "Projeto não encontrado");
        sendJson(response, 200, { project, revision });
        return;
      }
      if (request.method === "PUT") {
        const principal = requireMutationSession(context, database, config, writeRate);
        if (!canEdit(principal.user.role)) {
          throw new HttpError(403, "editor_required", "Permissão de edição necessária");
        }
        const body = record(await readJson(request, config.maxSnapshotBytes + config.maxJsonBytes));
        const baseRevision = integerField(body, "baseRevision", 1);
        const explanation = stringField(body, "explanation", { max: 2_000 });
        const snapshot = plainJsonObject(body.snapshot, "snapshot");
        assertSerializedSize(snapshot, config.maxSnapshotBytes);
        const updated = database.updateSnapshot(projectId, baseRevision, snapshot, explanation, principal.user);
        hub.broadcastRevision(projectId, updated.revision);
        sendJson(response, 200, updated);
        return;
      }
    }

    const chatMatch = /^\/api\/projects\/([^/]+)\/chat$/.exec(url.pathname);
    if (chatMatch) {
      const projectId = opaqueId(chatMatch[1] ?? "", "projectId");
      if (request.method === "GET") {
        requireSession(request, database, config);
        const afterRaw = url.searchParams.get("after") ?? undefined;
        if (afterRaw && !Number.isFinite(Date.parse(afterRaw))) {
          throw new HttpError(400, "invalid_after", "Parâmetro after deve ser uma data ISO");
        }
        const after = afterRaw ? new Date(afterRaw).toISOString() : undefined;
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw === null ? 50 : Number(limitRaw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(400, "invalid_limit", "limit deve estar entre 1 e 100");
        }
        sendJson(response, 200, { messages: database.listChatMessages(projectId, after, limit) });
        return;
      }
      if (request.method === "POST") {
        const principal = requireMutationSession(context, database, config, chatRate);
        const body = record(await readJson(request, config.maxJsonBytes));
        const text = stringField(body, "body", { max: config.maxChatChars });
        const message = database.addChatMessage(projectId, principal.user, text);
        hub.broadcastChat(projectId, message);
        sendJson(response, 201, { message });
        return;
      }
    }

    const changeSetCollectionMatch = /^\/api\/projects\/([^/]+)\/change-sets$/.exec(url.pathname);
    if (changeSetCollectionMatch) {
      const projectId = opaqueId(changeSetCollectionMatch[1] ?? "", "projectId");
      if (request.method === "GET") {
        requireSession(request, database, config);
        sendJson(response, 200, { changeSets: changeSets.list(projectId) });
        return;
      }
      if (request.method === "POST") {
        const principal = requireMutationSession(context, database, config, writeRate);
        const body = record(await readJson(request, config.maxJsonBytes));
        const created = changeSets.create(
          projectId,
          {
            title: stringField(body, "title", { max: 120 }),
            explanation: stringField(body, "explanation", { max: 4_000 }),
            operations: body.operations,
            ...(body.sourceProposalIds === undefined
              ? {}
              : { sourceProposalIds: stringArray(body.sourceProposalIds, "sourceProposalIds", 16) }),
          },
          principal.user,
        );
        hub.broadcastChangeSet(projectId, created.changeSet, "created");
        sendJson(response, 201, created);
        return;
      }
    }

    const changeSetDetailMatch = /^\/api\/projects\/([^/]+)\/change-sets\/([^/]+)$/.exec(url.pathname);
    if (changeSetDetailMatch) {
      const projectId = opaqueId(changeSetDetailMatch[1] ?? "", "projectId");
      const changeSetId = opaqueId(changeSetDetailMatch[2] ?? "", "changeSetId");
      if (request.method === "GET") {
        requireSession(request, database, config);
        sendJson(response, 200, changeSets.getDetail(projectId, changeSetId));
        return;
      }
      if (request.method === "PATCH") {
        const principal = requireMutationSession(context, database, config, writeRate);
        const body = record(await readJson(request, config.maxJsonBytes));
        if (
          body.title === undefined &&
          body.explanation === undefined &&
          body.operations === undefined &&
          body.sourceProposalIds === undefined
        ) {
          throw new HttpError(400, "content_change_required", "Informe ao menos uma alteração de conteúdo");
        }
        const updated = changeSets.edit(
          projectId,
          changeSetId,
          {
            baseVersion: integerField(body, "baseVersion", 1),
            reason: stringField(body, "reason", { max: 4_000 }),
            ...(body.title === undefined ? {} : { title: stringField(body, "title", { max: 120 }) }),
            ...(body.explanation === undefined
              ? {}
              : { explanation: stringField(body, "explanation", { max: 4_000 }) }),
            ...(body.operations === undefined ? {} : { operations: body.operations }),
            ...(body.sourceProposalIds === undefined
              ? {}
              : { sourceProposalIds: stringArray(body.sourceProposalIds, "sourceProposalIds", 16) }),
          },
          principal.user,
        );
        hub.broadcastChangeSet(projectId, updated.changeSet, "content-revised");
        sendJson(response, 200, updated);
        return;
      }
    }

    const changeSetActionMatch =
      /^\/api\/projects\/([^/]+)\/change-sets\/([^/]+)\/(ready|testing|tests|review)$/.exec(url.pathname);
    if (changeSetActionMatch && request.method === "POST") {
      const projectId = opaqueId(changeSetActionMatch[1] ?? "", "projectId");
      const changeSetId = opaqueId(changeSetActionMatch[2] ?? "", "changeSetId");
      const action = changeSetActionMatch[3];
      const principal = requireMutationSession(context, database, config, writeRate);
      const body = record(await readJson(request, config.maxJsonBytes));
      if (action === "ready" || action === "testing") {
        const explanation = stringField(body, "explanation", { max: 4_000 });
        const detail =
          action === "ready"
            ? changeSets.markReady(projectId, changeSetId, explanation, principal.user)
            : changeSets.markTesting(projectId, changeSetId, explanation, principal.user);
        hub.broadcastChangeSet(projectId, detail.changeSet, action);
        sendJson(response, 200, detail);
        return;
      }
      if (action === "tests") {
        const testInput = parseSandboxTestRequest(body);
        const detail = changeSets.recordTest(projectId, changeSetId, testInput, principal.user);
        hub.broadcastChangeSet(projectId, detail.changeSet, "test-recorded");
        sendJson(response, 201, detail);
        return;
      }
      if (action === "review") {
        const reviewInput = parseReviewChangeSetRequest(body);
        const detail = changeSets.review(projectId, changeSetId, reviewInput, principal.user);
        hub.broadcastChangeSet(projectId, detail.changeSet, `review:${reviewInput.decision}`);
        sendJson(response, 200, detail);
        return;
      }
    }

    const activityMatch = /^\/api\/projects\/([^/]+)\/activity$/.exec(url.pathname);
    if (activityMatch && request.method === "GET") {
      requireSession(request, database, config);
      const projectId = opaqueId(activityMatch[1] ?? "", "projectId");
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new HttpError(400, "invalid_limit", "limit deve estar entre 1 e 500");
      }
      sendJson(response, 200, { activity: changeSets.listActivity(projectId, limit) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ai/models") {
      const principal = requireSession(request, database, config);
      aiRate.assertAllowed(`${principal.user.id}:models`);
      const models = await aiGate.run(`${principal.user.id}:ai`, () => verboo.listModels());
      sendJson(response, 200, { models });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/chat") {
      const principal = requireMutationSession(context, database, config, aiRate);
      const body = record(await readJson(request, config.maxJsonBytes));
      const messages = parseAdvisoryMessages(body.messages, config.maxAiChars);
      const model = optionalStringField(body, "model", 200);
      const reply = await aiGate.run(`${principal.user.id}:ai`, () => verboo.advisoryChat(messages, model));
      sendJson(response, 200, { mode: "advisory", applied: false, reply });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/propose") {
      const principal = requireMutationSession(context, database, config, aiRate);
      if (!canEdit(principal.user.role)) {
        throw new HttpError(403, "editor_required", "Permissão de edição necessária para gerar uma proposta");
      }
      const body = record(await readJson(request, config.maxJsonBytes));
      const projectId = opaqueId(stringField(body, "projectId", { max: 128 }), "projectId");
      if (!database.getProject(projectId)) {
        throw new HttpError(404, "project_not_found", "Projeto não encontrado");
      }
      const prompt = stringField(body, "prompt", { max: config.maxAiChars });
      const model = optionalStringField(body, "model", 200);
      const generation = await aiGate.run(`${principal.user.id}:ai`, () => verboo.proposeChange(prompt, model));
      const proposalId = randomUUID();
      const createdAt = new Date().toISOString();
      const promptDigest = createHash("sha256").update(prompt, "utf8").digest("hex");
      const auditRecord = {
        proposalId,
        projectId,
        createdAt,
        promptDigest,
        author: principal.user,
        provider: generation.provider,
        model: generation.model,
        requestId: generation.requestId,
        candidate: generation.candidate,
      };
      database.appendAiProposalActivity(auditRecord);
      sendJson(response, 200, {
        mode: "proposal",
        applied: false,
        ...auditRecord,
      });
      return;
    }

    throw new HttpError(404, "not_found", "Rota não encontrada");
  }

  return {
    httpServer,
    database,
    hub,
    async listen() {
      if (listening) throw new Error("Servidor já está escutando");
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        httpServer.once("error", onError);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off("error", onError);
          resolve();
        });
      });
      listening = true;
      const address = httpServer.address() as AddressInfo;
      return { host: address.address, port: address.port };
    },
    async close() {
      hub.close();
      if (listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
        listening = false;
      }
      if (ownsDatabase) database.close();
    },
  };
}

function requireMutationSession(
  context: RouteContext,
  database: StudioDatabase,
  config: StudioConfig,
  limiter: FixedWindowRateLimiter,
) {
  const principal = requireSession(context.request, database, config);
  requireCsrf(context.request, principal);
  limiter.assertAllowed(principal.user.id);
  return principal;
}

function applyCors(request: IncomingMessage, response: ServerResponse, config: StudioConfig): void {
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (!config.corsOrigins.has(origin)) throw new HttpError(403, "origin_denied", "Origem não permitida");
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    if (!origin) throw new HttpError(400, "origin_required", "Preflight sem origem");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Studio-CSRF");
    response.setHeader("Access-Control-Max-Age", "600");
  }
}

async function readJson(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  if (!METHODS_WITH_BODY.has(request.method ?? "")) throw new HttpError(400, "body_not_allowed", "Corpo não aceito");
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "json_required", "Content-Type deve ser application/json");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new HttpError(413, "payload_too_large", "Corpo excede o limite técnico");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maximumBytes) throw new HttpError(413, "payload_too_large", "Corpo excede o limite técnico");
    chunks.push(buffer);
  }
  if (size === 0) throw new HttpError(400, "body_required", "Corpo JSON obrigatório");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "JSON inválido");
  }
}

function parseAdvisoryMessages(value: unknown, maximumCharacters: number): AdvisoryMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    throw new HttpError(400, "invalid_messages", "Envie entre 1 e 30 mensagens");
  }
  let total = 0;
  const messages = value.map((item) => {
    const source = record(item, "Cada mensagem deve ser um objeto");
    const role = stringField(source, "role", { max: 20 });
    if (role !== "user" && role !== "assistant") {
      throw new HttpError(400, "invalid_message_role", "Apenas user e assistant são aceitos");
    }
    const parsedRole: AdvisoryMessage["role"] = role;
    const content = stringField(source, "content", { max: maximumCharacters });
    total += content.length;
    return { role: parsedRole, content };
  });
  if (total > maximumCharacters) {
    throw new HttpError(413, "ai_context_too_large", "Conversa excede o limite técnico da IA");
  }
  if (!messages.some((message) => message.role === "user")) {
    throw new HttpError(400, "user_message_required", "A conversa precisa de uma mensagem do usuário");
  }
  return messages;
}

function assertSerializedSize(value: unknown, maximumBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maximumBytes) throw new HttpError(413, "snapshot_too_large", "Snapshot excede o limite técnico");
}

function stringArray(value: unknown, label: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "invalid_string_array", `${label} deve ser uma lista de até ${maximumItems} textos`);
  }
  return value.map((item) => (item as string).trim());
}

function sha256Field(source: Record<string, unknown>, name: string): string {
  return stringField(source, name, { min: 64, max: 64, pattern: /^[0-9a-f]{64}$/ });
}

function parseSandboxTestRequest(body: Record<string, unknown>): RecordSandboxTestInput {
  const status = stringField(body, "status", { max: 20 });
  if (status !== "passed" && status !== "failed") {
    throw new HttpError(400, "invalid_test_status", "status do teste deve ser passed ou failed");
  }
  if (!Array.isArray(body.checks) || body.checks.length < 1 || body.checks.length > 64) {
    throw new HttpError(400, "invalid_checks", "checks deve conter entre 1 e 64 verificações");
  }
  return {
    revisionId: opaqueId(stringField(body, "revisionId", { max: 128 }), "revisionId"),
    revisionDigest: sha256Field(body, "revisionDigest"),
    status,
    checks: body.checks.map(parseSandboxCheckRequest),
    startedAt: stringField(body, "startedAt", { max: 50 }),
    completedAt: stringField(body, "completedAt", { max: 50 }),
  };
}

function parseSandboxCheckRequest(value: unknown): SandboxCheckInput {
  const check = record(value, "Cada check deve ser um objeto");
  const status = stringField(check, "status", { max: 20 });
  if (status !== "passed" && status !== "failed") {
    throw new HttpError(400, "invalid_check_status", "Status de check inválido");
  }
  const details = check.details;
  if (details !== null && details !== undefined && (typeof details !== "string" || details.trim().length > 2_000)) {
    throw new HttpError(400, "invalid_check_details", "Detalhes do check inválidos");
  }
  return {
    ...(check.checkId === undefined
      ? {}
      : { checkId: opaqueId(stringField(check, "checkId", { max: 128 }), "checkId") }),
    name: stringField(check, "name", { max: 120 }),
    status,
    details: typeof details === "string" ? details.trim() : null,
  };
}

function parseReviewChangeSetRequest(body: Record<string, unknown>): ReviewChangeSetInput {
  const decision = stringField(body, "decision", { max: 30 });
  if (decision !== "approve" && decision !== "request-changes" && decision !== "reject") {
    throw new HttpError(400, "invalid_review_decision", "Decisão de revisão inválida");
  }
  return {
    decision,
    revisionId: opaqueId(stringField(body, "revisionId", { max: 128 }), "revisionId"),
    revisionDigest: sha256Field(body, "revisionDigest"),
    explanation: stringField(body, "explanation", { max: 4_000 }),
  };
}

function sessionResponse(session: { user: unknown; csrfToken: string; expiresAt: string }): Record<string, unknown> {
  return { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function handleError(response: ServerResponse, error: unknown, requestId: string): void {
  if (response.headersSent || response.writableEnded) {
    response.destroy();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message }, requestId });
    return;
  }
  logger.error("unhandled_request_error", error, { requestId });
  sendJson(response, 500, { error: { code: "internal_error", message: "Erro interno" }, requestId });
}

function remoteKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function safePath(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? "/", "http://studio.invalid").pathname;
  } catch {
    return "[invalid]";
  }
}
