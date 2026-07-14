import type { StudioLayoutPreference } from "./model";

export const STUDIO_SERVER_STORAGE_KEY = "oficina.studio.server-url";
export const STUDIO_LAYOUT_STORAGE_KEY = "oficina.studio.layout";
export const STUDIO_PROJECT_STORAGE_KEY = "oficina.studio.project";

export function isStudioRoute(url: URL): boolean {
  return url.searchParams.get("studio") === "1";
}

export function editorUrlFromStudio(url: URL): string {
  const editorUrl = new URL(url);
  for (const parameter of [
    "studio",
    "studioServer",
  ]) {
    editorUrl.searchParams.delete(parameter);
  }
  editorUrl.hash = "";
  return editorUrl.toString();
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
  return (
    safeStorageGet(storage, STUDIO_SERVER_STORAGE_KEY) ??
    buildTimeUrl?.trim() ??
    null
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
