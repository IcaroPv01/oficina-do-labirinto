import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_PROJECT, parseGameProject } from "../core";
import { patchEditorProject, readEditorProject } from "./project-adapter";

describe("project adapter", () => {
  it("edita os campos públicos sem violar o schema", () => {
    const patched = patchEditorProject(DEFAULT_GAME_PROJECT, {
      name: "A Cripta",
      seed: "cripta-42",
      playerPrimaryColor: "#112233",
      playerSecondaryColor: "#445566",
      playerHealth: 8,
      playerSpeed: 240,
      enemy: {
        name: "Guardião",
        color: "#aa3344",
        health: 7,
        speed: 90,
        damage: 2,
      },
    });

    const valid = parseGameProject(patched);
    const fields = readEditorProject(valid);
    expect(fields).toMatchObject({
      name: "A Cripta",
      seed: "cripta-42",
      playerPrimaryColor: "#112233",
      playerSecondaryColor: "#445566",
      playerHealth: 8,
      playerSpeed: 240,
      enemy: {
        name: "Guardião",
        color: "#aa3344",
        health: 7,
        speed: 90,
        damage: 2,
      },
    });
  });

  it("incorpora uma skin PNG no jogador", () => {
    const patched = patchEditorProject(DEFAULT_GAME_PROJECT, {
      playerSkin: {
        filename: "heroi.png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        width: 32,
        height: 32,
        bytes: 8,
      },
    });

    const fields = readEditorProject(parseGameProject(patched));
    expect(fields.playerSkin?.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});
