export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Erro desconhecido");
}
