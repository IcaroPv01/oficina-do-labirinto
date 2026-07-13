import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_GAME_PROJECT, parseGameProject } from "../src/core";
import { serializeGamepack } from "../src/editor/gamepack";
import { applyGamepackFile } from "./apply-gamepack-file";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("applyGamepackFile", () => {
  it("aplica um gamepack válido no arquivo de conteúdo", async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, "projeto.gamepack");
    const output = join(directory, "default-project.json");
    await writeFile(input, serializeGamepack(DEFAULT_GAME_PROJECT), "utf8");

    await applyGamepackFile(input, output);

    expect(parseGameProject(JSON.parse(await readFile(output, "utf8")))).toEqual(
      DEFAULT_GAME_PROJECT,
    );
  });

  it("não substitui o último arquivo quando a importação é inválida", async () => {
    const directory = await createTemporaryDirectory();
    const input = join(directory, "invalido.gamepack");
    const output = join(directory, "default-project.json");
    await writeFile(input, "{ inválido", "utf8");
    await writeFile(output, "ultimo-conteudo-valido", "utf8");

    await expect(applyGamepackFile(input, output)).rejects.toThrow(/JSON válido/i);
    await expect(readFile(output, "utf8")).resolves.toBe(
      "ultimo-conteudo-valido",
    );
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "oficina-gamepack-"));
  temporaryDirectories.push(directory);
  return directory;
}
