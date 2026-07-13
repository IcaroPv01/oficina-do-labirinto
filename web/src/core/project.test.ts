import { describe, expect, it } from "vitest";
import defaultProjectJson from "../../../game-data/default-project.json";
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

  it("serializa e reabre sem perder dados", () => {
    const text = serializeGameProject(DEFAULT_GAME_PROJECT);
    expect(parseGameProjectText(text)).toEqual(DEFAULT_GAME_PROJECT);
  });
});

