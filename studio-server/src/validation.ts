import { HttpError } from "./errors.js";

export function record(value: unknown, message = "Corpo JSON deve ser um objeto"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", message);
  }
  return value as Record<string, unknown>;
}

export function stringField(
  source: Record<string, unknown>,
  name: string,
  options: { min?: number; max: number; pattern?: RegExp } = { max: 1_000 },
): string {
  const value = source[name];
  const minimum = options.min ?? 1;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${name} deve ser texto`);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > options.max) {
    throw new HttpError(
      400,
      "invalid_field",
      `${name} deve ter entre ${minimum} e ${options.max} caracteres`,
    );
  }
  if (options.pattern && !options.pattern.test(normalized)) {
    throw new HttpError(400, "invalid_field", `${name} possui formato inválido`);
  }
  return normalized;
}

export function optionalStringField(
  source: Record<string, unknown>,
  name: string,
  max: number,
): string | undefined {
  const value = source[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new HttpError(400, "invalid_field", `${name} deve ser texto com no máximo ${max} caracteres`);
  }
  return value.trim();
}

export function integerField(
  source: Record<string, unknown>,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = source[name];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HttpError(400, "invalid_field", `${name} deve ser um inteiro válido`);
  }
  return value as number;
}

export function opaqueId(value: string, label = "id"): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(value)) {
    throw new HttpError(400, "invalid_id", `${label} inválido`);
  }
  return value;
}

export function plainJsonObject(value: unknown, label: string): Record<string, unknown> {
  const object = record(value, `${label} deve ser um objeto JSON`);
  try {
    JSON.stringify(object);
  } catch {
    throw new HttpError(400, "invalid_json", `${label} não pode ser serializado`);
  }
  return object;
}
