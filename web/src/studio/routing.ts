import type { StudioLayoutPreference } from "./model";

export const STUDIO_SERVER_STORAGE_KEY = "oficina.studio.server-url";
export const STUDIO_LAYOUT_STORAGE_KEY = "oficina.studio.layout";
export const STUDIO_PROJECT_STORAGE_KEY = "oficina.studio.project";
export const DEFAULT_LOCAL_STUDIO_SERVER_URL = "http://127.0.0.1:8787";
const PUBLIC_STUDIO_SERVER_PARAMETER = "publicStudioServer";
const PUBLIC_PAGES_URL_PARAMETER = "publicPagesUrl";

export function isStudioRoute(url: URL): boolean {
  return url.searchParams.get("studio") === "1";
}

export function editorUrlFromStudio(url: URL): string {
  const editorUrl = new URL(url);
  for (const parameter of [
    "studio",
    "studioServer",
    PUBLIC_STUDIO_SERVER_PARAMETER,
    PUBLIC_PAGES_URL_PARAMETER,
  ]) {
    editorUrl.searchParams.delete(parameter);
  }
  editorUrl.hash = "";
  return editorUrl.toString();
}

/**
 * Reads the public tunnel advertised by the local bootstrap URL. This value is
 * only for invitation generation; configuredStudioServerUrl deliberately
 * ignores it so the owner's browser keeps talking to loopback.
 */
export function bootstrapPublicStudioServerUrl(url: URL): string | null {
  const value = url.searchParams.get(PUBLIC_STUDIO_SERVER_PARAMETER);
  if (value === null) return null;
  return validatedPublicHttpsUrl(value, "servidor público", false).toString();
}

/** Selects the public GitHub Pages base without trusting credentials or HTTP. */
export function bootstrapPublicPagesUrl(url: URL): URL | null {
  const value = url.searchParams.get(PUBLIC_PAGES_URL_PARAMETER);
  if (value === null) return null;
  return validatedPublicHttpsUrl(value, "endereço público do jogo", true);
}

export function inviteTokenFromUrl(url: URL): string | null {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return fragment.get("invite");
}

/** Removes one-use credentials without navigating or retaining them in history. */
export function urlWithoutInviteToken(url: URL): URL {
  const sanitized = new URL(url);
  const fragment = new URLSearchParams(sanitized.hash.replace(/^#/, ""));
  fragment.delete("invite");
  const remainingFragment = fragment.toString();
  sanitized.hash = remainingFragment ? `#${remainingFragment}` : "";
  return sanitized;
}

export function configuredStudioServerUrl(
  url: URL,
  storage: Storage,
  buildTimeUrl: string | undefined,
): string | null {
  const queryUrl = url.searchParams.get("studioServer")?.trim();
  if (queryUrl) {
    safeStorageSet(storage, STUDIO_SERVER_STORAGE_KEY, queryUrl);
    return queryUrl;
  }
  const storedUrl = safeStorageGet(storage, STUDIO_SERVER_STORAGE_KEY)?.trim();
  if (storedUrl) return storedUrl;
  const bundledUrl = buildTimeUrl?.trim();
  if (bundledUrl) return bundledUrl;
  return isLoopbackHostname(url.hostname)
    ? DEFAULT_LOCAL_STUDIO_SERVER_URL
    : null;
}

/** Builds a one-use Pages invitation. The credential is deliberately kept
 * after `#`, so it is not sent to GitHub Pages or included in server logs. */
export function createStudioInviteUrl(
  pagesUrl: URL,
  studioServerUrl: string,
  token: string,
): string {
  const normalizedToken = token.trim();
  if (!normalizedToken || normalizedToken !== token || /\s/.test(token)) {
    throw new Error("O token do convite é inválido.");
  }
  const serverUrl = validatedPublicHttpsUrl(
    studioServerUrl,
    "servidor público",
    false,
  );
  const invitation = validatedPublicHttpsUrl(
    pagesUrl.toString(),
    "endereço público do jogo",
    true,
  );
  for (const parameter of [
    "invite",
    PUBLIC_STUDIO_SERVER_PARAMETER,
    PUBLIC_PAGES_URL_PARAMETER,
  ]) {
    invitation.searchParams.delete(parameter);
  }
  invitation.searchParams.set("studio", "1");
  invitation.searchParams.set("studioServer", serverUrl.toString());
  invitation.hash = new URLSearchParams({ invite: normalizedToken }).toString();
  return invitation.toString();
}

function validatedPublicHttpsUrl(
  value: string,
  label: string,
  allowSearch: boolean,
): URL {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`O ${label} não pode ser vazio.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`O ${label} é inválido.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`O ${label} precisa usar HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`O ${label} não pode conter credenciais.`);
  }
  if (!allowSearch && (parsed.search || parsed.hash)) {
    throw new Error(`O ${label} não pode conter busca ou fragmento.`);
  }
  return parsed;
}

function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    hostname.toLowerCase(),
  );
}

export function readLayoutPreference(storage: Storage): StudioLayoutPreference {
  const value = safeStorageGet(storage, STUDIO_LAYOUT_STORAGE_KEY);
  return value === "desktop" || value === "mobile" ? value : "auto";
}

export function safeStorageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(
  storage: Storage,
  key: string,
  value: string,
): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Private browsing can disable storage; the current session still works.
  }
}
