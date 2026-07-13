import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_PROJECT, parseGameProject } from "../core";
import {
  GAMEPACK_FORMAT,
  GAMEPACK_VERSION,
  parseGamepack,
  serializeGamepack,
} from "./gamepack";

const parseProject = (value: unknown): { name: string } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    throw new Error("Nome ausente.");
  }

  return { name: value.name };
};

describe("gamepack", () => {
  it("exporta e importa um envelope versionado", () => {
    const text = serializeGamepack({ name: "Minha dungeon" });
    const envelope = JSON.parse(text) as Record<string, unknown>;

    expect(envelope.format).toBe(GAMEPACK_FORMAT);
    expect(envelope.formatVersion).toBe(GAMEPACK_VERSION);
    expect(parseGamepack(text, parseProject)).toEqual({ name: "Minha dungeon" });
  });

  it("recusa versão incompatível com mensagem útil", () => {
    const text = JSON.stringify({
      format: GAMEPACK_FORMAT,
      formatVersion: 99,
      exportedAt: new Date().toISOString(),
      project: { name: "Futuro" },
    });

    expect(() => parseGamepack(text, parseProject)).toThrow(/Versão 99/);
  });

  it("reabre um gamepack v1 criado antes das opções de run e de skin", () => {
    const legacy = structuredClone(DEFAULT_GAME_PROJECT) as unknown as Record<
      string,
      unknown
    >;
    delete legacy["run"];
    const player = legacy["player"];
    if (typeof player === "object" && player !== null && !Array.isArray(player)) {
      delete (player as Record<string, unknown>)["skinMetadata"];
    }

    const text = serializeGamepack(legacy);
    expect(parseGamepack(text, parseGameProject)).toEqual(DEFAULT_GAME_PROJECT);
  });
});
