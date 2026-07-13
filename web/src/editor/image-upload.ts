const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const KNOWN_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

export interface PngUploadConstraints {
  readonly maximumBytes?: number;
  readonly maximumPixels?: number;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
  readonly maximumWidth?: number;
  readonly maximumHeight?: number;
}

export interface ValidatedPng {
  readonly filename: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PngStructure {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly samplesPerPixel: number;
}

export interface ValidatedEmbeddedPng extends PngStructure {
  readonly sha256: string;
}

export async function readValidatedPng(
  file: File,
  constraints: PngUploadConstraints = {},
): Promise<ValidatedPng> {
  const maximumBytes = constraints.maximumBytes ?? 2 * 1024 * 1024;

  if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
    throw new Error("Escolha uma imagem PNG.");
  }

  if (file.size === 0) {
    throw new Error("A imagem está vazia.");
  }

  if (file.size > maximumBytes) {
    throw new Error(
      `A imagem excede ${formatBytes(maximumBytes)}. Reduza o arquivo e tente novamente.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const structure = inspectPngBytes(bytes, constraints);

  const blob = new Blob([bytes], { type: "image/png" });
  const dimensions = await readImageDimensions(blob);

  if (dimensions.width !== structure.width || dimensions.height !== structure.height) {
    throw new Error("O cabeçalho e a imagem PNG decodificada não correspondem.");
  }

  return {
    filename: file.name,
    dataUrl: bytesToDataUrl(bytes),
    width: dimensions.width,
    height: dimensions.height,
    bytes: file.size,
    sha256: await sha256Hex(bytes),
  };
}

export async function validateEmbeddedPngDataUrl(
  dataUrl: string | null,
  constraints: PngUploadConstraints = {},
): Promise<ValidatedEmbeddedPng | null> {
  if (dataUrl === null) {
    return null;
  }

  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("A skin incorporada não é um PNG em Base64.");
  }

  const maximumBytes = constraints.maximumBytes ?? 2 * 1024 * 1024;
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length > Math.ceil((maximumBytes * 4) / 3) + 4) {
    throw new Error(`A skin incorporada excede ${formatBytes(maximumBytes)}.`);
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("A skin incorporada contém Base64 inválido.");
  }
  if (btoa(binary) !== encoded) {
    throw new Error("A skin incorporada contém Base64 não canônico.");
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const structure = inspectPngBytes(bytes, constraints);
  const dimensions = await readImageDimensions(new Blob([bytes], { type: "image/png" }));
  if (dimensions.width !== structure.width || dimensions.height !== structure.height) {
    throw new Error("A skin incorporada possui dimensões inconsistentes.");
  }

  return {
    ...structure,
    sha256: await sha256Hex(bytes),
  };
}

/**
 * Validates PNG framing and CRCs before asking the browser to decode pixels.
 */
export function inspectPngBytes(
  bytes: Uint8Array,
  constraints: PngUploadConstraints = {},
): PngStructure {
  const maximumBytes = constraints.maximumBytes ?? 2 * 1024 * 1024;
  const minimumWidth = constraints.minimumWidth ?? 8;
  const minimumHeight = constraints.minimumHeight ?? 8;
  const maximumWidth = constraints.maximumWidth ?? 512;
  const maximumHeight = constraints.maximumHeight ?? 512;
  const maximumPixels = constraints.maximumPixels ?? maximumWidth * maximumHeight;

  if (bytes.length > maximumBytes) {
    throw new Error(`A imagem excede ${formatBytes(maximumBytes)}.`);
  }
  if (
    bytes.length < 45 ||
    !PNG_SIGNATURE.every((expected, index) => bytes[index] === expected)
  ) {
    throw new Error("O conteúdo do arquivo não é um PNG válido.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let samplesPerPixel = 0;
  let sawPalette = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const chunkEnd = offset + 12 + length;
    if (length > maximumBytes || chunkEnd > bytes.length) {
      throw new Error("O PNG possui um bloco truncado ou grande demais.");
    }

    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]?.toUpperCase()) {
      throw new Error("O PNG contém um tipo de bloco inválido.");
    }
    const isCritical = ((type.charCodeAt(0) || 0) & 0x20) === 0;
    if (isCritical && !KNOWN_CRITICAL_CHUNKS.has(type)) {
      throw new Error(`O PNG contém um bloco crítico desconhecido: ${type}.`);
    }
    const expectedCrc = view.getUint32(offset + 8 + length, false);
    const actualCrc = crc32(bytes, offset + 4, offset + 8 + length);
    if (expectedCrc !== actualCrc) {
      throw new Error(`O bloco ${type || "desconhecido"} do PNG está corrompido.`);
    }
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) {
      throw new Error("O PNG não começa com um cabeçalho IHDR válido.");
    }
    if (type === "IHDR") {
      if (chunkIndex !== 0) {
        throw new Error("O PNG contém mais de um cabeçalho IHDR.");
      }
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      bitDepth = bytes[offset + 16] ?? 0;
      colorType = bytes[offset + 17] ?? -1;
      samplesPerPixel = samplesForPngColorType(bitDepth, colorType);
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error("O PNG usa um método de codificação não suportado.");
      }
    } else if (type === "acTL") {
      throw new Error("PNG animado não é aceito como skin.");
    } else if (type === "PLTE") {
      if (
        sawImageData ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4
      ) {
        throw new Error("A paleta de cores do PNG é inválida.");
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (colorType === 3 && !sawPalette) {
        throw new Error("O PNG indexado não possui uma paleta de cores.");
      }
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) {
        throw new Error("O encerramento do PNG é inválido.");
      }
      sawEnd = true;
      break;
    }

    offset = chunkEnd;
    chunkIndex += 1;
    if (chunkIndex > 10_000) {
      throw new Error("O PNG contém blocos demais.");
    }
  }

  if (!sawImageData || !sawEnd) {
    throw new Error("O PNG está incompleto.");
  }
  if (
    width < minimumWidth ||
    height < minimumHeight ||
    width > maximumWidth ||
    height > maximumHeight ||
    width * height > maximumPixels
  ) {
    throw new Error(
      `A skin mede ${width}×${height}px. Use dimensões entre ${minimumWidth}×${minimumHeight}px e ${maximumWidth}×${maximumHeight}px.`,
    );
  }

  return {
    width,
    height,
    bytes: bytes.length,
    bitDepth,
    colorType,
    samplesPerPixel,
  };
}

function samplesForPngColorType(bitDepth: number, colorType: number): number {
  const allowedDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  const samples: Readonly<Record<number, number>> = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };
  if (!allowedDepths[colorType]?.includes(bitDepth)) {
    throw new Error("O PNG usa uma profundidade ou tipo de cor inválido.");
  }
  return samples[colorType] ?? 0;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function readImageDimensions(
  blob: Blob,
): Promise<{ readonly width: number; readonly height: number }> {
  if ("createImageBitmap" in globalThis) {
    try {
      const image = await createImageBitmap(blob);
      const result = { width: image.width, height: image.height };
      image.close();
      return result;
    } catch {
      throw new Error("Não foi possível decodificar esta imagem PNG.");
    }
  }

  return await new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível decodificar esta imagem PNG."));
    };
    image.src = url;
  });
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:image/png;base64,${btoa(binary)}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!("crypto" in globalThis) || !globalThis.crypto.subtle) {
    throw new Error("Este navegador não oferece verificação criptográfica da skin.");
  }

  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
