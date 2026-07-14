import { ChangeOperationsSchema, type ChangeOperation } from "@collaborative-roguelike/studio-contracts";
import { z } from "zod";
import type { StudioConfig } from "./config.js";
import { HttpError } from "./errors.js";

export interface AdvisoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModelView {
  readonly id: string;
  readonly ownedBy?: string;
}

export interface AdvisoryReply {
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

export interface AiProposalCandidate {
  readonly title: string;
  readonly explanation: string;
  readonly operations: readonly ChangeOperation[];
  readonly risks: readonly string[];
}

/** Safe provider metadata plus a candidate that already crossed the local schema boundary. */
export interface AiProposalGeneration {
  readonly provider: "verboo";
  readonly model: string;
  readonly requestId: string | null;
  readonly candidate: AiProposalCandidate;
}

const AiProposalCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    explanation: z.string().trim().min(1).max(4_000),
    operations: ChangeOperationsSchema.min(1),
    risks: z.array(z.string().trim().min(1).max(500)).max(8),
  })
  .strict();

// Verboo's JSON-object mode does not receive a machine-readable response
// schema, so the exact same schema used by the local trust boundary is also
// supplied as model guidance. The Zod parse below is still authoritative.
const AI_PROPOSAL_SCHEMA_INSTRUCTION = JSON.stringify(z.toJSONSchema(AiProposalCandidateSchema));

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function optionalText(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

export class VerbooClient {
  private readonly key: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly responseLimit: number;
  private readonly defaultModel: string | undefined;

  constructor(config: StudioConfig) {
    this.key = config.verbooApiKey;
    this.baseUrl = config.verbooBaseUrl;
    this.timeoutMs = config.verbooTimeoutMs;
    this.responseLimit = config.maxAiResponseBytes;
    this.defaultModel = config.verbooDefaultModel;
  }

  get configured(): boolean {
    return Boolean(this.key);
  }

  async listModels(): Promise<ModelView[]> {
    const payload = await this.request("/models", { method: "GET" });
    const record = asRecord(payload);
    const items = Array.isArray(record?.data) ? record.data : Array.isArray(payload) ? payload : [];
    return items.flatMap((item) => {
      const model = asRecord(item);
      const id = optionalText(model?.id, 200);
      if (!id) return [];
      const ownedBy = optionalText(model?.owned_by, 200);
      return ownedBy ? [{ id, ownedBy }] : [{ id }];
    });
  }

  async advisoryChat(messages: readonly AdvisoryMessage[], requestedModel?: string): Promise<AdvisoryReply> {
    const model = this.resolveModel(requestedModel);

    const payload = await this.request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Você é o assistente consultivo da Oficina do Labirinto. Explique mudanças com clareza. " +
              "Você não pode aplicar, promover ou publicar nada e nunca deve afirmar que alterou o projeto. " +
              "Não solicite nem revele chaves, cookies, tokens ou outros segredos.",
          },
          ...messages,
        ],
      }),
    });

    const root = asRecord(payload);
    const choices = Array.isArray(root?.choices) ? root.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    const content = optionalText(message?.content, this.responseLimit);
    if (!content) throw new HttpError(502, "invalid_ai_response", "A IA retornou uma resposta inesperada");
    const usageRecord = asRecord(root?.usage);
    const promptTokens = optionalCount(usageRecord?.prompt_tokens);
    const completionTokens = optionalCount(usageRecord?.completion_tokens);
    const totalTokens = optionalCount(usageRecord?.total_tokens);
    const usage =
      promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined
        ? {
            ...(promptTokens !== undefined ? { promptTokens } : {}),
            ...(completionTokens !== undefined ? { completionTokens } : {}),
            ...(totalTokens !== undefined ? { totalTokens } : {}),
          }
        : undefined;
    const id = optionalText(root?.id, 200);
    const responseModel = optionalText(root?.model, 200);
    const finishReason = optionalText(first?.finish_reason, 100);
    return {
      ...(id ? { id } : {}),
      ...(responseModel ? { model: responseModel } : {}),
      content,
      ...(finishReason ? { finishReason } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  /** Returns validated structured commands only; this method has no persistence or apply capability. */
  async proposeChange(prompt: string, requestedModel?: string): Promise<AiProposalGeneration> {
    const model = this.resolveModel(requestedModel);
    const payload = await this.request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        response_format: {
          // Verboo supports OpenAI's JSON-object mode, but currently rejects
          // json_schema upstream. The strict Zod parse below remains the trust
          // boundary: provider output is data, never executable code.
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content:
              "Você propõe mudanças para a Oficina do Labirinto sem aplicá-las. " +
              "Responda somente com um objeto JSON contendo title, explanation, operations e risks. " +
              "Use apenas os comandos estruturados permitidos; " +
              "nunca gere scripts, caminhos arbitrários, instruções de execução, segredos ou afirmações de que a mudança foi aplicada. " +
              `Siga exatamente este JSON Schema: ${AI_PROPOSAL_SCHEMA_INSTRUCTION}`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const root = asRecord(payload);
    const choices = Array.isArray(root?.choices) ? root.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    const content = optionalText(message?.content, this.responseLimit);
    if (!content) throw invalidProposalResponse();

    let candidate: unknown;
    try {
      candidate = JSON.parse(content) as unknown;
    } catch {
      throw invalidProposalResponse();
    }
    const parsed = AiProposalCandidateSchema.safeParse(candidate);
    if (!parsed.success) throw invalidProposalResponse();
    return {
      provider: "verboo",
      // Only bounded identifier fields are reflected from the provider. Any
      // diagnostic/body content remains behind the server trust boundary.
      model: this.safeProviderIdentifier(root?.model) ?? model,
      requestId: this.safeProviderIdentifier(root?.id) ?? null,
      candidate: parsed.data,
    };
  }

  private safeProviderIdentifier(value: unknown): string | undefined {
    const identifier = optionalText(value, 200);
    if (!identifier || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(identifier)) return undefined;
    // A malicious or broken upstream must never be able to echo our bearer
    // credential through a nominally safe metadata field.
    if (this.key && identifier.includes(this.key)) return undefined;
    return identifier;
  }

  private resolveModel(requestedModel?: string): string {
    const model = requestedModel ?? this.defaultModel;
    if (!model) {
      throw new HttpError(400, "model_required", "Escolha um modelo retornado por /api/ai/models");
    }
    if (model.length > 200 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
      throw new HttpError(400, "invalid_model", "Identificador de modelo inválido");
    }
    return model;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.key) throw new HttpError(503, "ai_not_configured", "A integração com a IA ainda não foi configurada");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${this.key}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "ai_unavailable", "Não foi possível contatar a IA");
    }
    if (!response.ok) {
      // Never reflect the provider body: it may contain request details or diagnostics.
      throw new HttpError(502, "ai_upstream_error", `A IA respondeu com status ${response.status}`);
    }
    const bytes = await readLimitedResponse(response, this.responseLimit);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new HttpError(502, "invalid_ai_response", "A IA retornou JSON inválido");
    }
  }
}

function invalidProposalResponse(): HttpError {
  return new HttpError(
    502,
    "invalid_ai_proposal",
    "A IA não retornou uma proposta estruturada compatível com o Estúdio",
  );
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new HttpError(502, "ai_response_too_large", "A resposta da IA excedeu o limite técnico");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new HttpError(502, "ai_response_too_large", "A resposta da IA excedeu o limite técnico");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
