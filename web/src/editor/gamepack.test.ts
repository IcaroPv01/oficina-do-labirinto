import { describe, expect, it } from "vitest";
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
});
