import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { DEFAULT_GAME_PROJECT, type GameProject } from "../src/core";
import { validateProjectSkinForContent } from "./validate-project-skin";

describe("validateProjectSkinForContent", () => {
  it("aceita o projeto procedural sem skin", () => {
    expect(() => validateProjectSkinForContent(DEFAULT_GAME_PROJECT)).not.toThrow();
  });

  it("aceita PNG íntegro quando hash e metadados conferem", () => {
    const png = makePng(deflateSync(Buffer.alloc(8 * (1 + 8 * 4))));
    expect(() => validateProjectSkinForContent(withSkin(png))).not.toThrow();
  });

  it("recusa pixels compactados inválidos e hash divergente", () => {
    const invalidPixels = makePng(Buffer.from("fluxo-invalido"));
    expect(() => validateProjectSkinForContent(withSkin(invalidPixels))).toThrow(
      /pixels compactados/i,
    );

    const valid = makePng(deflateSync(Buffer.alloc(8 * (1 + 8 * 4))));
    const mismatched = withSkin(valid);
    mismatched.player.skinMetadata!.sha256 = "a".repeat(64);
    expect(() => validateProjectSkinForContent(mismatched)).toThrow(/metadados/);
  });

  it("recusa zlib válido quando faltam scanlines da imagem declarada", () => {
    const incomplete = makePng(deflateSync(Buffer.alloc(1)));
    expect(() => validateProjectSkinForContent(withSkin(incomplete))).toThrow(
      /quantidade inválida de pixels/i,
    );
  });

  it("bloqueia skin sem proveniência ou com licença pendente", () => {
    const png = makePng(deflateSync(Buffer.alloc(8 * (1 + 8 * 4))));
    const missingMetadata: GameProject = {
      ...DEFAULT_GAME_PROJECT,
      player: {
        ...DEFAULT_GAME_PROJECT.player,
        skinDataUrl: `data:image/png;base64,${png.toString("base64")}`,
        skinMetadata: null,
      },
    };
    expect(() => validateProjectSkinForContent(missingMetadata)).toThrow(
      /metadados de origem/i,
    );

    const pending = withSkin(png);
    pending.player.skinMetadata!.license = "unverified";
    expect(() => validateProjectSkinForContent(pending)).toThrow(/confirme a licença/i);
  });

  it("recusa padding Base64 não canônico", () => {
    const png = makePng(deflateSync(Buffer.alloc(8 * (1 + 8 * 4))));
    const project = withSkin(png);
    project.player.skinDataUrl = `${project.player.skinDataUrl}====`;

    expect(() => validateProjectSkinForContent(project)).toThrow(/Base64 inválido/i);
  });
});

function withSkin(png: Buffer): GameProject {
  return {
    ...DEFAULT_GAME_PROJECT,
    player: {
      ...DEFAULT_GAME_PROJECT.player,
      skinDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      skinMetadata: {
        filename: "teste.png",
        width: 8,
        height: 8,
        bytes: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
        origin: "user-upload",
        license: "original",
      },
    },
  };
}

function makePng(compressedPixels: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0);
  header.writeUInt32BE(8, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", compressedPixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
