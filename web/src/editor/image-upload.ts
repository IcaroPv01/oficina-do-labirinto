const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface PngUploadConstraints {
  readonly maximumBytes?: number;
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
}

export async function readValidatedPng(
  file: File,
  constraints: PngUploadConstraints = {},
): Promise<ValidatedPng> {
  const maximumBytes = constraints.maximumBytes ?? 2 * 1024 * 1024;
  const minimumWidth = constraints.minimumWidth ?? 8;
  const minimumHeight = constraints.minimumHeight ?? 8;
  const maximumWidth = constraints.maximumWidth ?? 512;
  const maximumHeight = constraints.maximumHeight ?? 512;

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

  if (!PNG_SIGNATURE.every((expected, index) => bytes[index] === expected)) {
    throw new Error("O conteúdo do arquivo não é um PNG válido.");
  }

  const blob = new Blob([bytes], { type: "image/png" });
  const dimensions = await readImageDimensions(blob);

  if (
    dimensions.width < minimumWidth ||
    dimensions.height < minimumHeight ||
    dimensions.width > maximumWidth ||
    dimensions.height > maximumHeight
  ) {
    throw new Error(
      `A skin mede ${dimensions.width}×${dimensions.height}px. Use dimensões entre ${minimumWidth}×${minimumHeight}px e ${maximumWidth}×${maximumHeight}px.`,
    );
  }

  return {
    filename: file.name,
    dataUrl: bytesToDataUrl(bytes),
    width: dimensions.width,
    height: dimensions.height,
    bytes: file.size,
  };
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

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
