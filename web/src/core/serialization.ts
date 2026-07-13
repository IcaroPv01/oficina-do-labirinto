import { ZodError } from "zod";
import { parseGameProject, type GameProject } from "./project";

export function serializeGameProject(project: GameProject): string {
  return JSON.stringify(parseGameProject(project), null, 2);
}

export function parseGameProjectText(text: string): GameProject {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("O arquivo não contém JSON válido.");
  }

  try {
    return parseGameProject(value);
  } catch (cause: unknown) {
    if (cause instanceof ZodError) {
      const details = cause.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "projeto"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Projeto incompatível: ${details}`);
    }
    throw cause;
  }
}

