import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseGameProject } from "../src/core";
import { validateProjectSkinForContent } from "./validate-project-skin";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const projectPath = join(repositoryRoot, "game-data", "default-project.json");

const project = parseGameProject(JSON.parse(await readFile(projectPath, "utf8")));
validateProjectSkinForContent(project);
console.log("Conteúdo padrão validado.");
