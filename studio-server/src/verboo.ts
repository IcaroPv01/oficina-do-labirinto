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
    const model = requestedModel ?? this.defaultModel;
    if (!model) {
      throw new HttpError(400, "model_required", "Escolha um modelo retornado por /api/ai/models");
    }
    if (model.length > 200 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
      throw new HttpError(400, "invalid_model", "Identificador de modelo inválido");
    }

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
