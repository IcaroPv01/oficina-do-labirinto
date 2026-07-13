import { describe, expect, it } from "vitest";
import defaultProjectJson from "../../../game-data/default-project.json";
import jsonSchema from "../../../schemas/game-project.schema.json";
import {
  DEFAULT_GAME_PROJECT,
  parseGameProject,
  safeParseGameProject,
} from "./project";
import { parseGameProjectText, serializeGameProject } from "./serialization";

describe("GameProject", () => {
  it("mantém o arquivo padrão e a constante no mesmo contrato", () => {
    expect(parseGameProject(defaultProjectJson)).toEqual(DEFAULT_GAME_PROJECT);
  });

  it("recusa campos desconhecidos e cores inválidas", () => {
    const invalid = {
      ...DEFAULT_GAME_PROJECT,
      secret: "não deve passar",
      player: { ...DEFAULT_GAME_PROJECT.player, color: "azul" },
    };

    expect(safeParseGameProject(invalid).success).toBe(false);
  });

  it("recusa metadados de skin sem a imagem correspondente", () => {
    const invalid = {
      ...DEFAULT_GAME_PROJECT,
      player: {
        ...DEFAULT_GAME_PROJECT.player,
        skinMetadata: {
          filename: "heroi.png",
          width: 32,
          height: 32,
          bytes: 100,
          sha256: "a".repeat(64),
          origin: "user-upload",
          license: "original",
        },
      },
    };

    expect(safeParseGameProject(invalid).success).toBe(false);
  });

  it("migra projetos v1 anteriores à configuração de expedição", () => {
    const { run: _run, ...legacyWithoutRun } = DEFAULT_GAME_PROJECT;
    const {
      skinMetadata: _skinMetadata,
      ...legacyPlayer
    } = legacyWithoutRun.player;
    const legacy = { ...legacyWithoutRun, player: legacyPlayer };

    expect(parseGameProject(legacy)).toEqual(DEFAULT_GAME_PROJECT);
  });

  it("impede uma expedição configurada sem a chave que garante progressão", () => {
    const invalid = {
      ...DEFAULT_GAME_PROJECT,
      run: { ...DEFAULT_GAME_PROJECT.run, startingKeys: 0 },
    };
    expect(safeParseGameProject(invalid).success).toBe(false);
  });

  it("recusa padding Base64 não canônico antes da decodificação", () => {
    const invalid = {
      ...DEFAULT_GAME_PROJECT,
      player: {
        ...DEFAULT_GAME_PROJECT.player,
        skinDataUrl: "data:image/png;base64,iVBORw0KGgo=====",
      },
    };
    expect(safeParseGameProject(invalid).success).toBe(false);
  });

  it("serializa e reabre sem perder dados", () => {
    const text = serializeGameProject(DEFAULT_GAME_PROJECT);
    expect(parseGameProjectText(text)).toEqual(DEFAULT_GAME_PROJECT);
  });

  it("mantém defaults compatíveis também no contrato JSON externo", () => {
    const schema = jsonSchema as unknown as {
      readonly required: readonly string[];
      readonly properties: {
        readonly player: { readonly required: readonly string[] };
        readonly enemy: {
          readonly properties: {
            readonly name: { readonly pattern: string };
          };
        };
        readonly run: {
          readonly default: unknown;
          readonly properties: {
            readonly startingKeys: { readonly minimum: number };
          };
        };
      };
    };

    expect(schema.required).not.toContain("run");
    expect(schema.properties.player.required).not.toContain("skinMetadata");
    expect(schema.properties.enemy.properties.name.pattern).toBe("\\S");
    expect(schema.properties.run.default).toEqual(DEFAULT_GAME_PROJECT.run);
    expect(schema.properties.run.properties.startingKeys.minimum).toBe(1);
  });
});
