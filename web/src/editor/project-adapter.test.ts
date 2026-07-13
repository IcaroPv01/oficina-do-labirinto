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
      run: {
        endless: true,
        floorLimit: 5,
        roomsPerFloor: 12,
        startingCoins: 4,
        startingKeys: 2,
        shopHeartCost: 6,
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
      run: {
        endless: true,
        floorLimit: 5,
        roomsPerFloor: 12,
        startingCoins: 4,
        startingKeys: 2,
        shopHeartCost: 6,
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
        sha256: "a".repeat(64),
      },
    });

    const fields = readEditorProject(parseGameProject(patched));
    expect(fields.playerSkin?.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(fields.playerSkin).toMatchObject({
      filename: "heroi.png",
      width: 32,
      height: 32,
      bytes: 8,
      sha256: "a".repeat(64),
      license: "unverified",
    });

    const licensed = patchEditorProject(parseGameProject(patched), {
      playerSkinLicense: "original",
    });
    expect(readEditorProject(parseGameProject(licensed)).playerSkin?.license).toBe(
      "original",
    );
  });
});
