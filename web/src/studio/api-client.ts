import {
  ChangeSetSchema,
  type ChangeSet,
  type RevisionDigestMetadata,
  type SandboxTestRecord,
  type WorkspaceRole,
} from "@collaborative-roguelike/studio-contracts";

export type StudioBackendRole = WorkspaceRole;

export interface StudioPublicUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly role: StudioBackendRole;
}

export interface StudioSessionDto {
  readonly user: StudioPublicUserDto;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface StudioProjectSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly latestRevision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StudioRevisionDto {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly snapshot: Record<string, unknown>;
  readonly explanation: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface StudioProjectSnapshotDto {
  readonly project: StudioProjectSummaryDto;
  readonly revision: StudioRevisionDto;
}

export interface StudioChatMessageDto {
  readonly id: string;
  readonly projectId: string;
  readonly author: StudioPublicUserDto | null;
  readonly kind: "human" | "assistant" | "system";
  readonly body: string;
  readonly createdAt: string;
}

export interface StudioAiModelDto {
  readonly id: string;
  readonly ownedBy?: string;
}

export interface StudioAdvisoryMessageDto {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface StudioAdvisoryReplyDto {
  readonly id?: string;
  readonly model?: string;
  readonly content: string;
  readonly finishReason?: string;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
}

export type StudioChangeSetStatusDto = ChangeSet["status"];

export type StudioRevisionDigestDto = RevisionDigestMetadata;
export type StudioSandboxTestDto = SandboxTestRecord;
export type StudioChangeSetDto = ChangeSet;

export type StudioTransportMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface StudioTransportRequest {
  readonly method: StudioTransportMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly requiresCsrf?: boolean;
}

/** Cookie authentication and the CSRF value stay inside this boundary. */
export interface StudioTransport {
  send<Response>(request: StudioTransportRequest): Promise<Response>;
  setCsrfToken(token: string | null): void;
  readonly baseUrl: URL;
}

export interface StudioFetchTransportOptions {
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

export class StudioApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeStudioServerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Informe uma URL válida para o servidor do Estúdio.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("O Estúdio exige HTTPS; HTTP é aceito somente neste computador.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("A URL do Estúdio não pode conter credenciais, busca ou fragmento.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

export function createStudioFetchTransport(
  options: StudioFetchTransportOptions,
): StudioTransport {
  const baseUrl = normalizeStudioServerUrl(options.baseUrl);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let csrfToken: string | null = null;

  return {
    baseUrl,
    setCsrfToken(token) {
      csrfToken = token;
    },
    async send<Response>(request: StudioTransportRequest): Promise<Response> {
      if (request.requiresCsrf && !csrfToken) {
        throw new StudioApiError(
          403,
          "csrf_unavailable",
          "A sessão precisa ser renovada antes desta alteração.",
        );
      }
      const url = new URL(request.path.replace(/^\/+/, ""), ensureTrailingSlash(baseUrl));
      const headers = new Headers({ Accept: "application/json" });
      if (request.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
      if (request.requiresCsrf && csrfToken) {
        headers.set("X-Studio-CSRF", csrfToken);
      }
      const response = await fetchImplementation(url, {
        method: request.method,
        credentials: "include",
        cache: "no-store",
        headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (response.status === 204) {
        return undefined as Response;
      }
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        const error = apiError(payload);
        throw new StudioApiError(response.status, error.code, error.message);
      }
      return payload as Response;
    },
  };
}

export interface StudioServerApiClient {
  readonly transport: StudioTransport;
  getHealth(signal?: AbortSignal): Promise<{
    readonly status: "ok";
    readonly aiConfigured: boolean;
  }>;
  getSession(signal?: AbortSignal): Promise<StudioSessionDto>;
  redeemInvite(
    token: string,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<StudioSessionDto>;
  logout(signal?: AbortSignal): Promise<void>;
  listProjects(signal?: AbortSignal): Promise<readonly StudioProjectSummaryDto[]>;
  createProject(
    name: string,
    snapshot: Record<string, unknown>,
    explanation: string,
    signal?: AbortSignal,
  ): Promise<StudioProjectSnapshotDto>;
  getProjectSnapshot(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<StudioProjectSnapshotDto>;
  updateProjectSnapshot(
    projectId: string,
    baseRevision: number,
    snapshot: Record<string, unknown>,
    explanation: string,
    signal?: AbortSignal,
  ): Promise<StudioProjectSnapshotDto>;
  listChat(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<readonly StudioChatMessageDto[]>;
  sendChat(
    projectId: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<StudioChatMessageDto>;
  listModels(signal?: AbortSignal): Promise<readonly StudioAiModelDto[]>;
  advisoryChat(
    messages: readonly StudioAdvisoryMessageDto[],
    model: string,
    signal?: AbortSignal,
  ): Promise<StudioAdvisoryReplyDto>;
  listChangeSets(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<readonly StudioChangeSetDto[]>;
  reviewChangeSet(
    projectId: string,
    changeSetId: string,
    input: {
      readonly decision: "approve" | "request-changes" | "reject";
      readonly revisionId: string;
      readonly revisionDigest: string;
      readonly explanation: string;
    },
    signal?: AbortSignal,
  ): Promise<StudioChangeSetDto>;
}

export function createStudioServerApiClient(
  transport: StudioTransport,
): StudioServerApiClient {
  const client: StudioServerApiClient = {
    transport,
    getHealth(signal) {
      return transport.send(request("GET", "/health", undefined, signal));
    },
    async getSession(signal) {
      const session = await transport.send<StudioSessionDto>(
        request("GET", "/auth/me", undefined, signal),
      );
      transport.setCsrfToken(session.csrfToken);
      return session;
    },
    async redeemInvite(token, displayName, signal) {
      const session = await transport.send<StudioSessionDto>(
        request(
          "POST",
          "/auth/invites/redeem",
          { token, displayName },
          signal,
        ),
      );
      transport.setCsrfToken(session.csrfToken);
      return session;
    },
    async logout(signal) {
      await transport.send<void>(
        request("POST", "/auth/logout", {}, signal, true),
      );
      transport.setCsrfToken(null);
    },
    async listProjects(signal) {
      const response = await transport.send<{
        readonly projects: readonly StudioProjectSummaryDto[];
      }>(request("GET", "/api/projects", undefined, signal));
      return response.projects;
    },
    createProject(name, snapshot, explanation, signal) {
      return transport.send(
        request(
          "POST",
          "/api/projects",
          { name, snapshot, explanation },
          signal,
          true,
        ),
      );
    },
    getProjectSnapshot(projectId, signal) {
      return transport.send(
        request(
          "GET",
          `/api/projects/${segment(projectId)}/snapshot`,
          undefined,
          signal,
        ),
      );
    },
    updateProjectSnapshot(
      projectId,
      baseRevision,
      snapshot,
      explanation,
      signal,
    ) {
      return transport.send(
        request(
          "PUT",
          `/api/projects/${segment(projectId)}/snapshot`,
          { baseRevision, snapshot, explanation },
          signal,
          true,
        ),
      );
    },
    async listChat(projectId, signal) {
      const response = await transport.send<{
        readonly messages: readonly StudioChatMessageDto[];
      }>(
        request(
          "GET",
          `/api/projects/${segment(projectId)}/chat?limit=100`,
          undefined,
          signal,
        ),
      );
      return response.messages;
    },
    async sendChat(projectId, body, signal) {
      const response = await transport.send<{
        readonly message: StudioChatMessageDto;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/chat`,
          { body },
          signal,
          true,
        ),
      );
      return response.message;
    },
    async listModels(signal) {
      const response = await transport.send<{
        readonly models: readonly StudioAiModelDto[];
      }>(request("GET", "/api/ai/models", undefined, signal));
      return response.models;
    },
    async advisoryChat(messages, model, signal) {
      const response = await transport.send<{
        readonly mode: "advisory";
        readonly applied: false;
        readonly reply: StudioAdvisoryReplyDto;
      }>(
        request(
          "POST",
          "/api/ai/chat",
          { messages, model },
          signal,
          true,
        ),
      );
      return response.reply;
    },
    async listChangeSets(projectId, signal) {
      const response = await transport.send<{
        readonly changeSets: readonly unknown[];
      }>(
        request(
          "GET",
          `/api/projects/${segment(projectId)}/change-sets`,
          undefined,
          signal,
        ),
      );
      return response.changeSets.map(parseChangeSetResponse);
    },
    async reviewChangeSet(projectId, changeSetId, input, signal) {
      const response = await transport.send<{
        readonly changeSet: unknown;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/change-sets/${segment(changeSetId)}/review`,
          input,
          signal,
          true,
        ),
      );
      return parseChangeSetResponse(response.changeSet);
    },
  };
  return client;
}

function request(
  method: StudioTransportMethod,
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  requiresCsrf = false,
): StudioTransportRequest {
  return {
    method,
    path,
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
    ...(requiresCsrf ? { requiresCsrf: true } : {}),
  };
}

function segment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("O identificador do Estúdio não pode ser vazio.");
  }
  return encodeURIComponent(normalized);
}

function ensureTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  normalized.pathname = `${normalized.pathname.replace(/\/+$/, "")}/`;
  return normalized;
}

function parseChangeSetResponse(value: unknown): StudioChangeSetDto {
  const parsed = ChangeSetSchema.safeParse(value);
  if (!parsed.success) {
    throw new StudioApiError(
      502,
      "invalid_change_set_response",
      "O servidor retornou uma proposta incompatível com esta versão do Estúdio.",
    );
  }
  return parsed.data;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new StudioApiError(
      response.status,
      "invalid_response",
      "O servidor do Estúdio respondeu em um formato inesperado.",
    );
  }
  return response.json() as Promise<unknown>;
}

function apiError(payload: unknown): { code: string; message: string } {
  if (typeof payload !== "object" || payload === null) {
    return { code: "request_failed", message: "A solicitação ao Estúdio falhou." };
  }
  const error = (payload as { readonly error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return { code: "request_failed", message: "A solicitação ao Estúdio falhou." };
  }
  const code = (error as { readonly code?: unknown }).code;
  const message = (error as { readonly message?: unknown }).message;
  return {
    code: typeof code === "string" ? code : "request_failed",
    message:
      typeof message === "string"
        ? message
        : "A solicitação ao Estúdio falhou.",
  };
}
