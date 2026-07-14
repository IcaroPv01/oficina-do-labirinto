import {
  ChangeOperationsSchema,
  ChangeSetSchema,
  type ChangeOperation,
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

export interface StudioSandboxCheckInput {
  readonly checkId?: string;
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly details: string | null;
}

/** Evidence submitted by the sandbox for one exact candidate revision. */
export interface StudioSandboxTestInput {
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly status: "passed" | "failed";
  readonly checks: readonly StudioSandboxCheckInput[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface StudioAiProposalCandidateDto {
  readonly title: string;
  readonly explanation: string;
  readonly operations: readonly ChangeOperation[];
  readonly risks: readonly string[];
}

/** Non-secret provenance for one AI candidate that has not been applied. */
export interface StudioAiProposalDto {
  readonly proposalId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly promptDigest: string;
  readonly author: StudioPublicUserDto;
  readonly provider: string;
  readonly model: string;
  readonly requestId: string | null;
  readonly candidate: StudioAiProposalCandidateDto;
}

export interface StudioCreateChangeSetInput {
  readonly title: string;
  readonly explanation: string;
  readonly operations: readonly ChangeOperation[];
  readonly sourceProposalIds?: readonly string[];
}

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
  createChangeSet(
    projectId: string,
    input: StudioCreateChangeSetInput,
    signal?: AbortSignal,
  ): Promise<StudioChangeSetDto>;
  markChangeSetReady(
    projectId: string,
    changeSetId: string,
    explanation: string,
    signal?: AbortSignal,
  ): Promise<StudioChangeSetDto>;
  markChangeSetTesting(
    projectId: string,
    changeSetId: string,
    explanation: string,
    signal?: AbortSignal,
  ): Promise<StudioChangeSetDto>;
  recordSandboxTest(
    projectId: string,
    changeSetId: string,
    input: StudioSandboxTestInput,
    signal?: AbortSignal,
  ): Promise<StudioChangeSetDto>;
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
  proposeChangeWithAi(
    projectId: string,
    prompt: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<StudioAiProposalDto>;
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
    async createChangeSet(projectId, input, signal) {
      const operations = ChangeOperationsSchema.min(1).parse(input.operations);
      const response = await transport.send<{
        readonly changeSet: unknown;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/change-sets`,
          {
            title: input.title,
            explanation: input.explanation,
            operations,
            ...(input.sourceProposalIds === undefined
              ? {}
              : { sourceProposalIds: input.sourceProposalIds }),
          },
          signal,
          true,
        ),
      );
      return parseChangeSetResponse(response.changeSet);
    },
    async markChangeSetReady(projectId, changeSetId, explanation, signal) {
      const response = await transport.send<{
        readonly changeSet: unknown;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/change-sets/${segment(changeSetId)}/ready`,
          { explanation },
          signal,
          true,
        ),
      );
      const changeSet = parseChangeSetResponse(response.changeSet);
      if (changeSet.status !== "proposed") {
        throw new StudioApiError(
          502,
          "invalid_ready_response",
          "O servidor não confirmou que a proposta ficou pronta para teste.",
        );
      }
      return changeSet;
    },
    async markChangeSetTesting(projectId, changeSetId, explanation, signal) {
      const response = await transport.send<{
        readonly changeSet: unknown;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/change-sets/${segment(changeSetId)}/testing`,
          { explanation },
          signal,
          true,
        ),
      );
      const changeSet = parseChangeSetResponse(response.changeSet);
      if (changeSet.status !== "testing") {
        throw new StudioApiError(
          502,
          "invalid_testing_response",
          "O servidor não confirmou que a proposta entrou em teste.",
        );
      }
      return changeSet;
    },
    async recordSandboxTest(projectId, changeSetId, input, signal) {
      validateSandboxTestInput(input);
      const response = await transport.send<{
        readonly changeSet: unknown;
      }>(
        request(
          "POST",
          `/api/projects/${segment(projectId)}/change-sets/${segment(changeSetId)}/tests`,
          input,
          signal,
          true,
        ),
      );
      const changeSet = parseChangeSetResponse(response.changeSet);
      assertRecordedTestTargetsRequestedRevision(changeSet, input);
      return changeSet;
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
    async proposeChangeWithAi(projectId, prompt, model, signal) {
      const response = await transport.send<{
        readonly mode?: unknown;
        readonly applied?: unknown;
        readonly proposalId?: unknown;
        readonly projectId?: unknown;
        readonly createdAt?: unknown;
        readonly promptDigest?: unknown;
        readonly author?: unknown;
        readonly provider?: unknown;
        readonly model?: unknown;
        readonly requestId?: unknown;
        readonly candidate?: unknown;
      }>(
        request(
          "POST",
          "/api/ai/propose",
          { projectId, prompt, model },
          signal,
          true,
        ),
      );
      if (response.mode !== "proposal" || response.applied !== false) {
        throw invalidAiProposalResponse();
      }
      const proposal = parseAiProposalResponse(response);
      if (proposal.projectId !== projectId) {
        throw invalidAiProposalResponse();
      }
      return proposal;
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

function validateSandboxTestInput(input: StudioSandboxTestInput): void {
  if (!isServerOpaqueId(input.revisionId) || !/^[0-9a-f]{64}$/.test(input.revisionDigest)) {
    throw invalidSandboxTestInput("Informe a revisão candidata e seu digest SHA-256 exatos.");
  }
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 64) {
    throw invalidSandboxTestInput("O teste precisa conter entre 1 e 64 verificações.");
  }
  if (input.status !== "passed" && input.status !== "failed") {
    throw invalidSandboxTestInput("O resultado geral do teste é inválido.");
  }
  const suppliedCheckIds = new Set<string>();
  for (const check of input.checks) {
    const name = typeof check.name === "string" ? check.name.trim() : "";
    if (!name || name.length > 120) {
      throw invalidSandboxTestInput("Cada verificação precisa de um nome com até 120 caracteres.");
    }
    if (
      check.details !== null &&
      (typeof check.details !== "string" || check.details.trim().length > 2_000)
    ) {
      throw invalidSandboxTestInput("Os detalhes de uma verificação excedem 2.000 caracteres.");
    }
    if (check.status !== "passed" && check.status !== "failed") {
      throw invalidSandboxTestInput("O resultado de uma verificação é inválido.");
    }
    if (check.checkId !== undefined) {
      if (!isServerOpaqueId(check.checkId) || suppliedCheckIds.has(check.checkId)) {
        throw invalidSandboxTestInput("Os identificadores das verificações devem ser válidos e únicos.");
      }
      suppliedCheckIds.add(check.checkId);
    }
  }
  const hasFailedCheck = input.checks.some((check) => check.status === "failed");
  if (
    (input.status === "passed" && hasFailedCheck) ||
    (input.status === "failed" && !hasFailedCheck)
  ) {
    throw invalidSandboxTestInput("O resultado geral precisa corresponder aos resultados das verificações.");
  }
  const startedAt = Date.parse(input.startedAt);
  const completedAt = Date.parse(input.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    throw invalidSandboxTestInput("A janela de execução do teste é inválida.");
  }
}

function assertRecordedTestTargetsRequestedRevision(
  changeSet: StudioChangeSetDto,
  input: StudioSandboxTestInput,
): void {
  const recordedTest = changeSet.latestTest;
  if (
    recordedTest === null ||
    recordedTest.revisionId !== input.revisionId ||
    recordedTest.revisionDigest !== input.revisionDigest ||
    recordedTest.status !== input.status ||
    recordedTest.startedAt !== input.startedAt ||
    recordedTest.completedAt !== input.completedAt
  ) {
    throw new StudioApiError(
      502,
      "invalid_test_binding_response",
      "O servidor não vinculou o teste à revisão candidata informada.",
    );
  }
}

function parseAiProposalCandidate(value: unknown): StudioAiProposalCandidateDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidAiProposalResponse();
  }
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(["title", "explanation", "operations", "risks"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    throw invalidAiProposalResponse();
  }
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const explanation =
    typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
  const operations = ChangeOperationsSchema.safeParse(candidate.operations);
  const risks = Array.isArray(candidate.risks)
    ? candidate.risks.map((risk) => typeof risk === "string" ? risk.trim() : risk)
    : null;
  if (
    !title ||
    title.length > 120 ||
    !explanation ||
    explanation.length > 4_000 ||
    !operations.success ||
    operations.data.length === 0 ||
    risks === null ||
    risks.length > 8 ||
    risks.some((risk) => typeof risk !== "string" || !risk || risk.length > 500)
  ) {
    throw invalidAiProposalResponse();
  }
  return { title, explanation, operations: operations.data, risks: risks as string[] };
}

function parseAiProposalResponse(value: Record<string, unknown>): StudioAiProposalDto {
  const proposalId = value.proposalId;
  const projectId = value.projectId;
  const createdAt = value.createdAt;
  const promptDigest = value.promptDigest;
  const provider = value.provider;
  const model = value.model;
  const requestId = value.requestId;
  const author = value.author;
  if (
    !isServerOpaqueId(proposalId) ||
    !isServerOpaqueId(projectId) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof promptDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(promptDigest) ||
    typeof provider !== "string" ||
    provider.length < 1 ||
    provider.length > 80 ||
    typeof model !== "string" ||
    model.length < 1 ||
    model.length > 200 ||
    (requestId !== null && (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 200)) ||
    typeof author !== "object" ||
    author === null ||
    Array.isArray(author)
  ) {
    throw invalidAiProposalResponse();
  }
  const authorRecord = author as Record<string, unknown>;
  if (
    !isServerOpaqueId(authorRecord.id) ||
    typeof authorRecord.displayName !== "string" ||
    authorRecord.displayName.trim().length < 1 ||
    authorRecord.displayName.length > 80 ||
    !["owner", "editor", "reviewer", "viewer"].includes(String(authorRecord.role))
  ) {
    throw invalidAiProposalResponse();
  }
  return {
    proposalId,
    projectId,
    createdAt,
    promptDigest,
    author: {
      id: authorRecord.id as string,
      displayName: authorRecord.displayName.trim(),
      role: authorRecord.role as StudioBackendRole,
    },
    provider,
    model,
    requestId: requestId as string | null,
    candidate: parseAiProposalCandidate(value.candidate),
  };
}

function invalidSandboxTestInput(message: string): StudioApiError {
  return new StudioApiError(400, "invalid_sandbox_test_input", message);
}

function invalidAiProposalResponse(): StudioApiError {
  return new StudioApiError(
    502,
    "invalid_ai_proposal_response",
    "A IA não retornou uma proposta estruturada compatível com o Estúdio.",
  );
}

function isServerOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
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
