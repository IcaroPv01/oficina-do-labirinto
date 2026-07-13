const MAX_SKIN_DATA_URL_LENGTH = 8 * 1024 * 1024;
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|webp|jpeg|gif);base64,[a-z0-9+/=\s]+$/i;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ProjectPresentation {
  readonly title: string;
  readonly seed: string;
  readonly playerSkinDataUrl: string | null;
  readonly playerColor: string;
  readonly playerAccentColor: string;
  readonly enemyColor: string;
  readonly backgroundColor: string;
  readonly floorColor: string;
  readonly wallColor: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function firstString(value: unknown, paths: readonly (readonly string[])[]): string | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return null;
}

function isSafeImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SKIN_DATA_URL_LENGTH &&
    SAFE_IMAGE_DATA_URL.test(value)
  );
}

function firstHexColor(value: unknown, paths: readonly (readonly string[])[], fallback: string): string {
  const candidate = firstString(value, paths);
  return candidate !== null && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function readAssetSkin(project: unknown): string | null {
  const assetsCandidate = readPath(project, ["assets"]);
  const assets = Array.isArray(assetsCandidate) ? assetsCandidate : [];
  const selectedId = firstString(project, [
    ["player", "assetId"],
    ["player", "skinId"],
    ["content", "player", "assetId"],
    ["settings", "playerAssetId"],
  ]);

  const playerAssets = assets.filter((asset): asset is JsonRecord => {
    if (!isRecord(asset)) {
      return false;
    }
    const category = firstString(asset, [["category"], ["kind"], ["type"]]);
    return category === null || ["player", "skin", "character", "avatar"].includes(category.toLowerCase());
  });

  const selected = selectedId
    ? playerAssets.find((asset) => firstString(asset, [["id"]]) === selectedId)
    : playerAssets.find((asset) => asset["selected"] === true || asset["active"] === true);
  const fallback = selected ?? playerAssets[0];

  if (!fallback) {
    return null;
  }

  const data = firstString(fallback, [["dataUrl"], ["dataURL"], ["source"], ["data"]]);
  return isSafeImageDataUrl(data) ? data : null;
}

export function readProjectPresentation(project: unknown): ProjectPresentation {
  const directSkin = firstString(project, [
    ["player", "skinDataUrl"],
    ["player", "skin", "dataUrl"],
    ["content", "player", "skinDataUrl"],
    ["settings", "playerSkinDataUrl"],
  ]);

  return {
    title:
      firstString(project, [["name"], ["title"], ["metadata", "name"], ["meta", "name"]]) ??
      "Oficina do Labirinto",
    seed:
      firstString(project, [["seed"], ["game", "seed"], ["settings", "seed"], ["metadata", "seed"]]) ??
      "vertical-slice",
    playerSkinDataUrl: isSafeImageDataUrl(directSkin) ? directSkin : readAssetSkin(project),
    playerColor: firstHexColor(project, [["player", "color"]], "#5ce1c6"),
    playerAccentColor: firstHexColor(project, [["player", "accentColor"]], "#f5bd4f"),
    enemyColor: firstHexColor(project, [["enemy", "color"]], "#e05a76"),
    backgroundColor: firstHexColor(project, [["world", "backgroundColor"]], "#09111f"),
    floorColor: firstHexColor(project, [["world", "floorColor"]], "#263747"),
    wallColor: firstHexColor(project, [["world", "wallColor"]], "#5c7180"),
  };
}

export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
