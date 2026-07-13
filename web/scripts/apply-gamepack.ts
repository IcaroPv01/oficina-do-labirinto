import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGamepackFile } from "./apply-gamepack-file";

const inputArgument = process.argv[2];

if (!inputArgument) {
  console.error(
    "Uso: npm run content:apply -- caminho/para/projeto.gamepack",
  );
  process.exitCode = 1;
} else {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, "..", "..");
  const inputPath = resolve(process.cwd(), inputArgument);
  const outputPath = join(repositoryRoot, "game-data", "default-project.json");

  try {
    await applyGamepackFile(inputPath, outputPath);
    console.log(`Projeto validado e aplicado em ${outputPath}`);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`Não foi possível aplicar o gamepack: ${message}`);
    process.exitCode = 1;
  }
}
