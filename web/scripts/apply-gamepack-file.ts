import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { parseGameProject, type GameProject } from "../src/core";
import { parseGamepack } from "../src/editor/gamepack";
import { validateProjectSkinForContent } from "./validate-project-skin";

/** Validates fully, then atomically replaces the versioned content file. */
export async function applyGamepackFile(
  inputPath: string,
  outputPath: string,
): Promise<GameProject> {
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    const source = await readFile(inputPath, "utf8");
    const project = parseGamepack(source, parseGameProject);
    validateProjectSkinForContent(project);
    await writeFile(temporaryPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    await rename(temporaryPath, outputPath);
    return project;
  } catch (cause: unknown) {
    await rm(temporaryPath, { force: true });
    throw cause;
  }
}
