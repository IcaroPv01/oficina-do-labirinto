export const GAMEPACK_FORMAT = "jogo-colaborativo.gamepack";
export const GAMEPACK_VERSION = 1;

export interface Gamepack<T> {
  readonly format: typeof GAMEPACK_FORMAT;
  readonly formatVersion: typeof GAMEPACK_VERSION;
  readonly exportedAt: string;
  readonly project: T;
}

export type ProjectParser<T> = (value: unknown) => T;

export function createGamepack<T>(project: T, exportedAt = new Date()): Gamepack<T> {
  return {
    format: GAMEPACK_FORMAT,
    formatVersion: GAMEPACK_VERSION,
    exportedAt: exportedAt.toISOString(),
    project: structuredClone(project),
  };
}

export function serializeGamepack<T>(project: T): string {
  return JSON.stringify(createGamepack(project), null, 2);
}

export function parseGamepack<T>(text: string, parseProject: ProjectParser<T>): T {
  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("O arquivo não contém JSON válido.");
  }

  if (!isRecord(value)) {
    throw new Error("O gamepack não contém uma estrutura válida.");
  }

  if (value.format !== GAMEPACK_FORMAT) {
    throw new Error("Este arquivo não é um projeto .gamepack compatível.");
  }

  if (value.formatVersion !== GAMEPACK_VERSION) {
    const receivedVersion =
      typeof value.formatVersion === "number"
        ? String(value.formatVersion)
        : "desconhecida";
    throw new Error(
      `Versão ${receivedVersion} do gamepack não suportada. Esta versão do editor aceita ${GAMEPACK_VERSION}.`,
    );
  }

  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error("O gamepack não informa uma data de exportação válida.");
  }

  try {
    return parseProject(value.project);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    throw new Error(`Os dados do projeto são inválidos.${detail}`);
  }
}

export function downloadGamepack<T>(project: T, projectName: string): void {
  const blob = new Blob([serializeGamepack(project)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(projectName)}.gamepack`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileStem(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "meu-jogo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
