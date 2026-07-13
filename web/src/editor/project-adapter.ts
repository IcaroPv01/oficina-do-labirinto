import type { ValidatedPng } from "./image-upload";

type MutableRecord = Record<string, unknown>;
type Path = readonly string[];

const PATHS = {
  name: [["metadata", "name"], ["name"], ["title"]],
  seed: [["dungeon", "seed"], ["metadata", "seed"], ["seed"]],
  playerPrimary: [
    ["player", "colors", "primary"],
    ["player", "primaryColor"],
    ["player", "color"],
  ],
  playerSecondary: [
    ["player", "accentColor"],
    ["player", "colors", "secondary"],
    ["player", "secondaryColor"],
    ["player", "accentColor"],
  ],
  playerHealth: [["player", "maxHealth"], ["player", "health"]],
  playerSpeed: [["player", "speed"], ["player", "moveSpeed"]],
} as const satisfies Record<string, readonly Path[]>;

export interface EditorProjectFields {
  readonly name: string;
  readonly seed: string;
  readonly playerPrimaryColor: string;
  readonly playerSecondaryColor: string;
  readonly playerHealth: number;
  readonly playerSpeed: number;
  readonly playerSkin: EditorSkin | null;
  readonly enemy: EditorEnemy | null;
}

export interface EditorEnemy {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly health: number;
  readonly speed: number;
  readonly damage: number;
}

export interface EditorSkin {
  readonly filename: string;
  readonly dataUrl: string;
  readonly width: number | null;
  readonly height: number | null;
}

export type EditorProjectPatch = Partial<
  Pick<
    EditorProjectFields,
    | "name"
    | "seed"
    | "playerPrimaryColor"
    | "playerSecondaryColor"
    | "playerHealth"
    | "playerSpeed"
  >
> & {
  readonly enemy?: Partial<EditorEnemy>;
  readonly playerSkin?: ValidatedPng;
};

export function readEditorProject(project: unknown): EditorProjectFields {
  const enemy = readFirstEnemy(project);
  return {
    name: readString(project, PATHS.name) ?? "Oficina do Labirinto",
    seed: readString(project, PATHS.seed) ?? "vertical-slice",
    playerPrimaryColor: readColor(project, PATHS.playerPrimary) ?? "#7894ff",
    playerSecondaryColor:
      readColor(project, PATHS.playerSecondary) ?? "#dbe4ff",
    playerHealth: readNumber(project, PATHS.playerHealth) ?? 6,
    playerSpeed: readNumber(project, PATHS.playerSpeed) ?? 180,
    playerSkin: readPlayerSkin(project),
    enemy,
  };
}

export function patchEditorProject<T>(project: T, patch: EditorProjectPatch): T {
  const draft = structuredClone(project) as unknown;

  if (!isRecord(draft)) {
    throw new Error("A estrutura do projeto não pode ser editada.");
  }

  assignIfDefined(draft, PATHS.name, patch.name);
  assignIfDefined(draft, PATHS.seed, patch.seed);
  assignIfDefined(draft, PATHS.playerPrimary, patch.playerPrimaryColor);
  assignIfDefined(draft, PATHS.playerSecondary, patch.playerSecondaryColor);
  assignIfDefined(draft, PATHS.playerHealth, patch.playerHealth);
  assignIfDefined(draft, PATHS.playerSpeed, patch.playerSpeed);

  if (patch.enemy) {
    patchFirstEnemy(draft, patch.enemy);
  }

  if (patch.playerSkin) {
    patchPlayerSkin(draft, patch.playerSkin);
  }

  return draft as T;
}

function patchFirstEnemy(draft: MutableRecord, patch: Partial<EditorEnemy>): void {
  const enemy = isRecord(draft["enemy"])
    ? draft["enemy"]
    : Array.isArray(draft["enemies"]) && isRecord(draft["enemies"][0])
      ? draft["enemies"][0]
      : null;

  if (!enemy) {
    throw new Error("O projeto não possui um inimigo editável.");
  }
  assignRecordKey(enemy, ["name", "label"], patch.name);
  assignRecordKey(enemy, ["color", "tint"], patch.color);
  assignRecordKey(enemy, ["health", "maxHealth", "hp"], patch.health);
  assignRecordKey(enemy, ["speed", "moveSpeed"], patch.speed);
  assignRecordKey(enemy, ["damage", "contactDamage"], patch.damage);
}

function patchPlayerSkin(draft: MutableRecord, png: ValidatedPng): void {
  if (isRecord(draft["player"]) && "skinDataUrl" in draft["player"]) {
    draft["player"]["skinDataUrl"] = png.dataUrl;
    return;
  }

  const assets = draft["assets"];

  if (!Array.isArray(assets)) {
    throw new Error("O projeto não possui uma biblioteca de assets compatível.");
  }

  const selectedId = readString(draft, [
    ["player", "assetId"],
    ["player", "skinId"],
  ]);
  const records = assets.filter(isRecord);
  const selected =
    records.find((asset) => readDirectString(asset, ["id"]) === selectedId) ??
    records.find((asset) => {
      const category = readDirectString(asset, ["category", "kind", "type"]);
      return category !== null && ["player", "skin", "character"].includes(category);
    });

  if (!selected) {
    throw new Error("Nenhum asset de jogador foi encontrado para substituir.");
  }

  assignRecordKey(selected, ["dataUrl", "source", "data"], png.dataUrl);
  assignRecordKey(selected, ["filename", "name"], png.filename);
  assignRecordKey(selected, ["width"], png.width, false);
  assignRecordKey(selected, ["height"], png.height, false);

  const dimensions = selected["dimensions"];
  if (isRecord(dimensions)) {
    assignRecordKey(dimensions, ["width"], png.width, false);
    assignRecordKey(dimensions, ["height"], png.height, false);
  }
}

function readFirstEnemy(project: unknown): EditorEnemy | null {
  if (!isRecord(project)) {
    return null;
  }

  const enemy = isRecord(project["enemy"])
    ? project["enemy"]
    : Array.isArray(project["enemies"])
      ? project["enemies"].find(isRecord)
      : undefined;
  if (!enemy) {
    return null;
  }

  return {
    id: readDirectString(enemy, ["id"]) ?? "enemy-1",
    name: readDirectString(enemy, ["name", "label"]) ?? "Inimigo",
    color: readDirectColor(enemy, ["color", "tint"]) ?? "#e05a76",
    health: readDirectNumber(enemy, ["health", "maxHealth", "hp"]) ?? 3,
    speed: readDirectNumber(enemy, ["speed", "moveSpeed"]) ?? 80,
    damage: readDirectNumber(enemy, ["damage", "contactDamage"]) ?? 1,
  };
}

function readPlayerSkin(project: unknown): EditorSkin | null {
  if (!isRecord(project)) {
    return null;
  }

  const directDataUrl = getPath(project, ["player", "skinDataUrl"]);
  if (typeof directDataUrl === "string" && directDataUrl.startsWith("data:image/png;base64,")) {
    return {
      filename: "skin-personalizada.png",
      dataUrl: directDataUrl,
      width: null,
      height: null,
    };
  }

  if (!Array.isArray(project["assets"])) {
    return null;
  }

  const selectedId = readString(project, [
    ["player", "assetId"],
    ["player", "skinId"],
  ]);
  const assets = project["assets"].filter(isRecord);
  const selected =
    assets.find((asset) => readDirectString(asset, ["id"]) === selectedId) ??
    assets.find((asset) => {
      const category = readDirectString(asset, ["category", "kind", "type"]);
      return category !== null && ["player", "skin", "character"].includes(category);
    });

  if (!selected) {
    return null;
  }

  const dataUrl = readDirectString(selected, ["dataUrl", "source", "data"]);
  if (!dataUrl?.startsWith("data:image/png;base64,")) {
    return null;
  }

  const dimensions = isRecord(selected["dimensions"])
    ? selected["dimensions"]
    : selected;
  return {
    filename: readDirectString(selected, ["filename", "name"]) ?? "skin.png",
    dataUrl,
    width: readDirectNumber(dimensions, ["width"]),
    height: readDirectNumber(dimensions, ["height"]),
  };
}

function assignIfDefined(
  root: MutableRecord,
  paths: readonly Path[],
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  const existingPath = paths.find((path) => getPath(root, path) !== undefined);
  const path = existingPath ?? paths[0];

  if (!path) {
    return;
  }

  setPath(root, path, value);
}

function assignRecordKey(
  record: MutableRecord,
  keys: readonly string[],
  value: unknown,
  createWhenAbsent = true,
): void {
  if (value === undefined) {
    return;
  }

  const key = keys.find((candidate) => candidate in record) ??
    (createWhenAbsent ? keys[0] : undefined);
  if (key) {
    record[key] = value;
  }
}

function readString(root: unknown, paths: readonly Path[]): string | null {
  for (const path of paths) {
    const value = getPath(root, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function readNumber(root: unknown, paths: readonly Path[]): number | null {
  for (const path of paths) {
    const value = getPath(root, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readColor(root: unknown, paths: readonly Path[]): string | null {
  for (const path of paths) {
    const value = getPath(root, path);
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
      return value;
    }
  }
  return null;
}

function readDirectString(record: MutableRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function readDirectNumber(record: MutableRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readDirectColor(record: MutableRecord, keys: readonly string[]): string | null {
  const value = readDirectString(record, keys);
  return value !== null && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function getPath(root: unknown, path: Path): unknown {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPath(root: MutableRecord, path: Path, value: unknown): void {
  let current = root;
  const lastIndex = path.length - 1;

  path.forEach((segment, index) => {
    if (index === lastIndex) {
      current[segment] = value;
      return;
    }

    if (!isRecord(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as MutableRecord;
  });
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
