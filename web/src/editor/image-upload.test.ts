import { describe, expect, it } from "vitest";
import { inspectPngBytes, validateEmbeddedPngDataUrl } from "./image-upload";

describe("inspectPngBytes", () => {
  it("aceita a estrutura estática mínima dentro dos limites", () => {
    expect(inspectPngBytes(fakePng(32, 32))).toMatchObject({
      width: 32,
      height: 32,
    });
  });

  it("recusa dimensões capazes de provocar pressão de memória", () => {
    expect(() => inspectPngBytes(fakePng(8_192, 8_192))).toThrow(/mede 8192×8192/);
  });

  it("recusa APNG e blocos truncados", () => {
    expect(() => inspectPngBytes(fakePng(32, 32, true))).toThrow(/animado/);
    expect(() => inspectPngBytes(fakePng(32, 32).subarray(0, 30))).toThrow(/PNG/);
  });

  it("recusa um bloco cujo CRC não corresponde ao conteúdo", () => {
    const corrupted = fakePng(32, 32);
    corrupted[20] = (corrupted[20] ?? 0) ^ 0xff;
    expect(() => inspectPngBytes(corrupted)).toThrow(/corrompido/);
  });

  it("recusa blocos críticos desconhecidos", () => {
    expect(() => inspectPngBytes(fakePng(32, 32, false, "ABCD"))).toThrow(
      /crítico desconhecido/i,
    );
  });

  it("recusa Base64 com bits de padding não canônicos", async () => {
    await expect(
      validateEmbeddedPngDataUrl("data:image/png;base64,Zh=="),
    ).rejects.toThrow(/não canônico/i);
  });
});

function fakePng(
  width: number,
  height: number,
  animated = false,
  extraChunk?: string,
): Uint8Array {
  const chunks = [chunk("IHDR", ihdr(width, height))];
  if (animated) {
    chunks.push(chunk("acTL", new Uint8Array(8)));
  }
  if (extraChunk) {
    chunks.push(chunk(extraChunk, new Uint8Array()));
  }
  chunks.push(chunk("IDAT", new Uint8Array([0])));
  chunks.push(chunk("IEND", new Uint8Array()));
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const totalLength = signature.length + chunks.reduce((sum, value) => sum + value.length, 0);
  const result = new Uint8Array(totalLength);
  result.set(signature);
  let offset = signature.length;
  for (const value of chunks) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  for (let index = 0; index < 4; index += 1) {
    result[4 + index] = type.charCodeAt(index);
  }
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)), false);
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
