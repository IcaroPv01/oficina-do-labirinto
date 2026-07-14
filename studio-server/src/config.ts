import { resolve } from "node:path";

export type CookieSameSite = "strict" | "lax" | "none";

export interface StudioConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly corsOrigins: ReadonlySet<string>;
  readonly cookieSecure: boolean;
  readonly cookieSameSite: CookieSameSite;
  readonly cookieName: string;
  readonly sessionTtlMs: number;
  readonly inviteTtlMs: number;
  readonly devAuthEnabled: boolean;
  readonly maxJsonBytes: number;
  readonly maxSnapshotBytes: number;
  readonly maxWsBytes: number;
  readonly maxChatChars: number;
  readonly maxAiChars: number;
  readonly maxAiResponseBytes: number;
  readonly verbooApiKey: string | undefined;
  readonly verbooBaseUrl: string;
  readonly verbooDefaultModel: string | undefined;
  readonly verbooTimeoutMs: number;
}

function envText(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const raw = env[name]?.trim();
  if (raw) return raw;
  if (fallback !== undefined) return fallback;
  throw new Error(`Variável obrigatória ausente: ${name}`);
}

function envBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} deve ser true ou false`);
}

function envInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}`);
  }
  return parsed;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function parseOrigins(value: string): ReadonlySet<string> {
  const origins = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error("STUDIO_CORS_ORIGINS não pode ficar vazio");

  const parsed = origins.map((origin) => {
    if (origin.includes("*")) throw new Error("STUDIO_CORS_ORIGINS não aceita curingas");
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Origem CORS inválida: ${origin}`);
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`Origem CORS deve conter somente protocolo, host e porta: ${origin}`);
    }
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      throw new Error(`HTTP só é aceito para uma origem local: ${origin}`);
    }
    return url.origin;
  });

  if (new Set(parsed).size !== parsed.length) {
    throw new Error("STUDIO_CORS_ORIGINS contém origens repetidas");
  }
  return new Set(parsed);
}

function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VERBOO_BASE_URL inválida");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("VERBOO_BASE_URL não pode conter credenciais, busca ou fragmento");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("VERBOO_BASE_URL deve usar HTTPS (HTTP é permitido apenas em teste local)");
  }
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): StudioConfig {
  const host = envText(env, "STUDIO_HOST", "127.0.0.1");
  const cookieSecure = envBoolean(env, "STUDIO_COOKIE_SECURE", true);
  const cookieSameSiteRaw = envText(env, "STUDIO_COOKIE_SAME_SITE", "none").toLowerCase();
  if (!(["strict", "lax", "none"] as const).includes(cookieSameSiteRaw as CookieSameSite)) {
    throw new Error("STUDIO_COOKIE_SAME_SITE deve ser strict, lax ou none");
  }
  const cookieSameSite = cookieSameSiteRaw as CookieSameSite;
  const devAuthEnabled = envBoolean(env, "STUDIO_DEV_AUTH_ENABLED", false);

  if (!cookieSecure && !isLoopbackHost(host)) {
    throw new Error("Cookie sem Secure só é permitido quando STUDIO_HOST é loopback");
  }
  if (cookieSameSite === "none" && !cookieSecure) {
    throw new Error("SameSite=None exige STUDIO_COOKIE_SECURE=true");
  }
  if (devAuthEnabled && !isLoopbackHost(host)) {
    throw new Error("STUDIO_DEV_AUTH_ENABLED só pode ser usado com STUDIO_HOST local");
  }

  const databaseValue = envText(env, "STUDIO_DATABASE_PATH", "./data/studio.sqlite");
  const databasePath = databaseValue === ":memory:" ? databaseValue : resolve(cwd, databaseValue);
  const sessionTtlHours = envInteger(env, "STUDIO_SESSION_TTL_HOURS", 168, 1, 24 * 90);
  const inviteTtlHours = envInteger(env, "STUDIO_INVITE_TTL_HOURS", 24, 1, 24 * 30);

  return Object.freeze({
    host,
    port: envInteger(env, "STUDIO_PORT", 8787, 0, 65_535),
    databasePath,
    corsOrigins: parseOrigins(envText(env, "STUDIO_CORS_ORIGINS")),
    cookieSecure,
    cookieSameSite,
    cookieName: cookieSecure ? "__Host-oficina_studio" : "oficina_studio_dev",
    sessionTtlMs: sessionTtlHours * 60 * 60 * 1_000,
    inviteTtlMs: inviteTtlHours * 60 * 60 * 1_000,
    devAuthEnabled,
    maxJsonBytes: envInteger(env, "STUDIO_MAX_JSON_BYTES", 256 * 1_024, 1_024, 2 * 1_024 * 1_024),
    maxSnapshotBytes: envInteger(
      env,
      "STUDIO_MAX_SNAPSHOT_BYTES",
      2 * 1_024 * 1_024,
      64 * 1_024,
      16 * 1_024 * 1_024,
    ),
    maxWsBytes: envInteger(env, "STUDIO_MAX_WS_BYTES", 64 * 1_024, 1_024, 1_024 * 1_024),
    maxChatChars: envInteger(env, "STUDIO_MAX_CHAT_CHARS", 8_000, 100, 50_000),
    maxAiChars: envInteger(env, "STUDIO_MAX_AI_CHARS", 24_000, 1_000, 200_000),
    maxAiResponseBytes: envInteger(
      env,
      "STUDIO_MAX_AI_RESPONSE_BYTES",
      2 * 1_024 * 1_024,
      64 * 1_024,
      16 * 1_024 * 1_024,
    ),
    verbooApiKey: env.VERBOO_API_KEY?.trim() || undefined,
    verbooBaseUrl: parseBaseUrl(envText(env, "VERBOO_BASE_URL", "https://code.verboo.ai/router/v1")),
    verbooDefaultModel: env.VERBOO_DEFAULT_MODEL?.trim() || undefined,
    verbooTimeoutMs: envInteger(env, "VERBOO_TIMEOUT_MS", 45_000, 1_000, 180_000),
  });
}
