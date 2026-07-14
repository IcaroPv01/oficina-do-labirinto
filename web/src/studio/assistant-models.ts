import type { StudioAssistantModelOption } from "./model";

const KNOWN_MODELS = {
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash",
    contextWindow: 1_048_576,
  },
  "glm-4.7-flash": {
    label: "GLM 4.7 Flash",
    contextWindow: 200_704,
  },
  "qwen3.6-27b": {
    label: "Qwen 3.6 27B",
    contextWindow: 262_144,
  },
} as const;

export const DEFAULT_STUDIO_MODEL_ID = "deepseek-v4-flash";

export function describeStudioModel(id: string): StudioAssistantModelOption {
  const canonicalId = id.replace(/^pro\//, "");
  const known = KNOWN_MODELS[canonicalId as keyof typeof KNOWN_MODELS];
  return known
    ? { id, label: known.label, contextWindow: known.contextWindow }
    : { id, label: id, contextWindow: null };
}

export function chooseStudioModel(
  availableIds: readonly string[],
  rememberedId: string | null,
): string | null {
  if (rememberedId && availableIds.includes(rememberedId)) {
    return rememberedId;
  }
  if (availableIds.includes(DEFAULT_STUDIO_MODEL_ID)) {
    return DEFAULT_STUDIO_MODEL_ID;
  }
  const providerPrefixedDefault = availableIds.find(
    (id) => id.replace(/^pro\//, "") === DEFAULT_STUDIO_MODEL_ID,
  );
  if (providerPrefixedDefault) {
    return providerPrefixedDefault;
  }
  return availableIds[0] ?? null;
}

export function formatContextWindow(tokens: number | null): string {
  return tokens === null
    ? "janela não informada"
    : `${new Intl.NumberFormat("pt-BR").format(tokens)} tokens`;
}
