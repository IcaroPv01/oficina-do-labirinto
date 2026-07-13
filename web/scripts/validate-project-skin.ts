import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import type { GameProject } from "../src/core";
import { inspectPngBytes } from "../src/editor/image-upload";

/** Extra build-time checks that rely on Node and therefore stay out of the browser bundle. */
export function validateProjectSkinForContent(project: GameProject): void {
  const dataUrl = project.player.skinDataUrl;
  const metadata = project.player.skinMetadata;
  if (dataUrl === null) {
    if (metadata !== null) {
      throw new Error("A skin possui metadados, mas a imagem está ausente.");
    }
    return;
  }

  const encoded = dataUrl.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) {
    throw new Error("A skin incorporada contém Base64 inválido.");
  }

  const structure = inspectPngBytes(bytes);
  const compressedParts: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      compressedParts.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const scanlineBytes = Math.ceil(
    (structure.width * structure.samplesPerPixel * structure.bitDepth) / 8,
  );
  const expectedPixelBytes = structure.height * (scanlineBytes + 1);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(compressedParts), {
      maxOutputLength: expectedPixelBytes + 1,
    });
  } catch {
    throw new Error("Os pixels compactados da skin PNG estão corrompidos.");
  }
  if (pixels.length !== expectedPixelBytes) {
    throw new Error("A skin PNG contém uma quantidade inválida de pixels.");
  }
  for (let row = 0; row < structure.height; row += 1) {
    if ((pixels[row * (scanlineBytes + 1)] ?? 255) > 4) {
      throw new Error("A skin PNG usa um filtro de linha inválido.");
    }
  }

  if (metadata === null) {
    throw new Error(
      "A skin precisa de metadados de origem, hash e licença antes de ser versionada.",
    );
  }
  if (metadata.license === "unverified") {
    throw new Error(
      "Confirme a licença da skin no editor antes de aplicar o conteúdo.",
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    metadata.width !== structure.width ||
    metadata.height !== structure.height ||
    metadata.bytes !== structure.bytes ||
    metadata.sha256 !== sha256
  ) {
    throw new Error("A skin não corresponde aos metadados gravados no projeto.");
  }
}
