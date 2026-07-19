import {
  MAX_PROJECT_FILES_PER_MANIFEST,
  MAX_PROJECT_FILE_SIZE_BYTES,
  ProjectFileContentSchema,
  ProjectFileManifestSchema,
  type ProjectFileCategory,
  type ProjectFileContent,
  type ProjectFileEntry,
  type ProjectFileImageMediaType,
  type ProjectFileManifest,
  type ProjectFileTextMediaType,
} from "@collaborative-roguelike/studio-contracts";
import { createHash } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { digestCanonicalJson } from "./canonical-json.js";
import { HttpError } from "./errors.js";

interface DirectoryRule {
  readonly prefix: string;
  readonly category: ProjectFileCategory;
}

type MediaDescriptor =
  | { readonly kind: "text"; readonly mediaType: ProjectFileTextMediaType }
  | { readonly kind: "image"; readonly mediaType: ProjectFileImageMediaType };

const DIRECTORY_RULES: readonly DirectoryRule[] = [
  { prefix: "src", category: "source" },
  { prefix: "web/src", category: "source" },
  { prefix: "web/tests", category: "source" },
  { prefix: "web/scripts", category: "source" },
  // Files here are already intended for GitHub Pages; active SVG remains text-only.
  { prefix: "web/public", category: "configuration" },
  { prefix: "studio-server/src", category: "source" },
  { prefix: "studio-server/test", category: "source" },
  { prefix: "packages/studio-contracts/src", category: "source" },
  { prefix: "game-data", category: "game-data" },
  { prefix: "docs", category: "documentation" },
  { prefix: "schemas", category: "configuration" },
  { prefix: "scripts", category: "source" },
  { prefix: ".github/workflows", category: "configuration" },
] as const;

/** Exact project/workspace files that are useful but do not belong to a browsable directory rule. */
const SAFE_EXACT_FILES = new Map<string, ProjectFileCategory>([
  ["README.md", "documentation"],
  ["ROADMAP.md", "documentation"],
  ["LICENSE", "documentation"],
  ["THIRD_PARTY_NOTICES.md", "documentation"],
  ["package.json", "configuration"],
  ["package-lock.json", "configuration"],
  [".editorconfig", "configuration"],
  [".gitattributes", "configuration"],
  [".gitignore", "configuration"],
  ["JogoMedieval.spec", "configuration"],
  ["INICIAR-ESTUDIO.cmd", "configuration"],
  ["main_script.py", "source"],
  ["web/index.html", "source"],
  ["web/package.json", "configuration"],
  ["web/playwright.config.ts", "configuration"],
  ["web/tsconfig.json", "configuration"],
  ["web/vite.config.ts", "configuration"],
  ["web/vitest.config.ts", "configuration"],
  ["web/public/THIRD_PARTY_NOTICES.txt", "documentation"],
  ["studio-server/.gitignore", "configuration"],
  ["studio-server/package.json", "configuration"],
  ["studio-server/README.md", "documentation"],
  ["studio-server/tsconfig.json", "configuration"],
  ["packages/studio-contracts/package.json", "configuration"],
  ["packages/studio-contracts/tsconfig.json", "configuration"],
  ["packages/studio-contracts/vitest.config.ts", "configuration"],
]);

const TEXT_MEDIA_TYPES = new Map<string, ProjectFileTextMediaType>([
  [".css", "text/css"],
  [".cmd", "text/plain"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".jsx", "text/javascript"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".ps1", "text/plain"],
  [".py", "text/x-python"],
  [".sh", "text/x-shellscript"],
  [".spec", "text/plain"],
  [".svg", "image/svg+xml"],
  [".toml", "application/toml"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".txt", "text/plain"],
  [".yaml", "application/yaml"],
  [".webmanifest", "application/manifest+json"],
  [".yml", "application/yaml"],
]);

const IMAGE_MEDIA_TYPES = new Map<string, ProjectFileImageMediaType>([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const DENIED_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".git",
  ".gnupg",
  ".local-backups",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".ssh",
  ".venv",
  "backup",
  "backups",
  "build",
  "coverage",
  "credential",
  "credentials",
  "dist",
  "__pycache__",
  "node_modules",
  "playwright-report",
  "repos",
  "secret",
  "secrets",
  "test-results",
  "venv",
]);

const MAX_PATH_CHARACTERS = 512;
const MAX_PATH_SEGMENTS = 32;
const MAX_PATH_SEGMENT_CHARACTERS = 128;
const MAX_VISITED_NODES = 2_048;
const MAX_MANIFEST_FILE_BYTES = 16 * 1_024 * 1_024;

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function forbiddenFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith(".env") ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/u.test(lower) ||
    /(?:^|[._-])(?:secret|secrets|credential|credentials)(?:[._-]|$)/u.test(lower) ||
    /(?:\.key|\.pem|\.p12|\.pfx|\.jks|\.keystore|\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?)$/u.test(lower)
  );
}

function hasDeniedSegment(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) => DENIED_DIRECTORY_NAMES.has(segment.toLowerCase()) || forbiddenFileName(segment));
}

function normalizeRequestedPath(value: string): string {
  if (value.length < 1 || value.length > MAX_PATH_CHARACTERS || value.includes("\\") || value.includes("\0")) {
    throw new HttpError(400, "invalid_project_file_path", "Caminho de arquivo inválido");
  }
  if (value.startsWith("/") || isAbsolute(value)) {
    throw new HttpError(400, "invalid_project_file_path", "Caminho de arquivo deve ser relativo ao projeto");
  }
  const segments = value.split("/");
  if (
    segments.length > MAX_PATH_SEGMENTS ||
    segments.some(
      (segment) =>
        segment.length < 1 ||
        segment.length > MAX_PATH_SEGMENT_CHARACTERS ||
        segment === "." ||
        segment === ".." ||
        segment.trim() !== segment ||
        segment.includes(":") ||
        /[\u0000-\u001f\u007f]/u.test(segment),
    )
  ) {
    throw new HttpError(400, "invalid_project_file_path", "Caminho de arquivo inválido");
  }
  return segments.join("/");
}

function ruleForPath(path: string): DirectoryRule | undefined {
  return DIRECTORY_RULES.find((rule) => path === rule.prefix || path.startsWith(`${rule.prefix}/`));
}

function mediaForPath(path: string): MediaDescriptor | undefined {
  if (SAFE_EXACT_FILES.has(path) && extname(path) === "") return { kind: "text", mediaType: "text/plain" };
  const extension = extname(path).toLowerCase();
  const textMediaType = TEXT_MEDIA_TYPES.get(extension);
  if (textMediaType) return { kind: "text", mediaType: textMediaType };
  const imageMediaType = IMAGE_MEDIA_TYPES.get(extension);
  if (imageMediaType) return { kind: "image", mediaType: imageMediaType };
  return undefined;
}

function categoryForPath(path: string, media: MediaDescriptor): ProjectFileCategory | undefined {
  if (media.kind === "image" || media.mediaType === "image/svg+xml") return "asset";
  return SAFE_EXACT_FILES.get(path) ?? ruleForPath(path)?.category;
}

function assertAllowedPath(path: string): { readonly path: string; readonly media: MediaDescriptor; readonly category: ProjectFileCategory } {
  const normalized = normalizeRequestedPath(path);
  const media = mediaForPath(normalized);
  const category = media ? categoryForPath(normalized, media) : undefined;
  if (hasDeniedSegment(normalized)) {
    throw new HttpError(403, "project_file_forbidden", "Arquivo sensível não pode ser exibido");
  }
  if (!media) {
    throw new HttpError(403, "project_file_forbidden", "Tipo de arquivo fora da área pública do projeto");
  }
  if (!category) {
    throw new HttpError(403, "project_file_forbidden", "Arquivo fora da área pública do projeto");
  }
  return { path: normalized, media, category };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function entryFromBytes(
  path: string,
  category: ProjectFileCategory,
  media: MediaDescriptor,
  bytes: Uint8Array,
): ProjectFileEntry {
  const common = {
    path,
    name: basename(path),
    category,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
  return media.kind === "text"
    ? { ...common, kind: "text", mediaType: media.mediaType }
    : { ...common, kind: "image", mediaType: media.mediaType };
}

/**
 * A deliberately small, read-only view over source files. The service never
 * accepts filesystem paths directly: every request crosses the same allowlist,
 * no-link and realpath checks used by the manifest.
 */
export class ProjectFileService {
  readonly #root: string;

  constructor(configuredRoot: string) {
    const absoluteRoot = resolve(configuredRoot);
    let rootStat;
    try {
      rootStat = lstatSync(absoluteRoot);
    } catch {
      throw new Error("STUDIO_PROJECT_ROOT não existe ou não pode ser acessado");
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("STUDIO_PROJECT_ROOT deve ser um diretório real, não um link");
    }
    // Use the native implementation so Windows resolves 8.3 aliases exactly as
    // the asynchronous realpath checks used for individual files.
    this.#root = realpathSync.native(absoluteRoot);
  }

  async manifest(projectId: string): Promise<ProjectFileManifest> {
    const paths = await this.#discoverAllowedPaths();
    const files: ProjectFileEntry[] = [];
    let totalBytes = 0;

    for (const path of paths) {
      const allowed = assertAllowedPath(path);
      const bytes = await this.#readAllowedFile(allowed.path, true);
      if (!bytes) continue;
      if (allowed.media.kind === "image" && bytes.byteLength === 0) continue;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_MANIFEST_FILE_BYTES) {
        throw new HttpError(413, "project_manifest_too_large", "Projeto excede o limite do navegador de arquivos");
      }
      files.push(entryFromBytes(allowed.path, allowed.category, allowed.media, bytes));
    }

    files.sort((left, right) => comparePaths(left.path, right.path));
    const manifestDigest = digestCanonicalJson({ schemaVersion: 1, projectId, files }).digest;
    return ProjectFileManifestSchema.parse({
      schemaVersion: 1,
      projectId,
      generatedAt: new Date().toISOString(),
      manifestDigest,
      files,
    });
  }

  async content(projectId: string, requestedPath: string): Promise<ProjectFileContent> {
    const allowed = assertAllowedPath(requestedPath);
    const bytes = await this.#readAllowedFile(allowed.path, false);
    if (!bytes) throw new HttpError(404, "project_file_not_found", "Arquivo não encontrado");
    if (allowed.media.kind === "image" && bytes.byteLength === 0) {
      throw new HttpError(415, "invalid_project_image", "Imagem vazia ou inválida");
    }
    const entry = entryFromBytes(allowed.path, allowed.category, allowed.media, bytes);

    let content: string;
    if (allowed.media.kind === "text") {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new HttpError(415, "invalid_project_file_encoding", "Arquivo de texto não contém UTF-8 válido");
      }
    } else {
      content = Buffer.from(bytes).toString("base64");
    }

    return ProjectFileContentSchema.parse({
      schemaVersion: 1,
      projectId,
      entry,
      encoding: allowed.media.kind === "text" ? "utf8" : "base64",
      content,
    });
  }

  async #discoverAllowedPaths(): Promise<string[]> {
    const discovered = new Set<string>();
    let visitedNodes = 0;

    for (const exactFile of SAFE_EXACT_FILES.keys()) {
      try {
        const parentPath = exactFile.split("/").slice(0, -1).join("/");
        const safeParent = await this.#safeDirectoryPath(parentPath);
        if (!safeParent) continue;
        const stat = await lstat(join(safeParent, basename(exactFile)));
        visitedNodes += 1;
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_PROJECT_FILE_SIZE_BYTES) {
          discovered.add(exactFile);
        }
      } catch (error: unknown) {
        if (!isMissingFileError(error)) throw error;
      }
    }

    for (const rule of DIRECTORY_RULES) {
      const pending = [rule.prefix];
      while (pending.length > 0) {
        const directoryPath = pending.pop();
        if (!directoryPath) break;
        let entries;
        try {
          const safeDirectory = await this.#safeDirectoryPath(directoryPath);
          visitedNodes += 1;
          if (!safeDirectory) continue;
          entries = await readdir(safeDirectory, { withFileTypes: true });
        } catch (error: unknown) {
          if (isMissingFileError(error)) continue;
          throw error;
        }

        entries.sort((left, right) => comparePaths(left.name, right.name));
        for (const entry of entries) {
          visitedNodes += 1;
          if (visitedNodes > MAX_VISITED_NODES) {
            throw new HttpError(413, "project_manifest_too_large", "Projeto possui arquivos demais para o navegador");
          }
          const path = `${directoryPath}/${entry.name}`;
          if (entry.isSymbolicLink() || hasDeniedSegment(path)) continue;
          if (entry.isDirectory()) {
            if (path.split("/").length <= MAX_PATH_SEGMENTS) pending.push(path);
            continue;
          }
          if (!entry.isFile() || !mediaForPath(path)) continue;
          try {
            assertAllowedPath(path);
          } catch (error: unknown) {
            if (error instanceof HttpError) continue;
            throw error;
          }
          const stat = await lstat(join(this.#root, ...path.split("/")));
          if (!stat.isSymbolicLink() && stat.size <= MAX_PROJECT_FILE_SIZE_BYTES) discovered.add(path);
          if (discovered.size > MAX_PROJECT_FILES_PER_MANIFEST) {
            throw new HttpError(413, "project_manifest_too_large", "Projeto possui arquivos demais para o navegador");
          }
        }
      }
    }

    return [...discovered].sort(comparePaths);
  }

  /** Resolve a directory only after every component has been proven to be a real directory. */
  async #safeDirectoryPath(path: string): Promise<string | undefined> {
    let candidate = this.#root;
    try {
      for (const segment of path === "" ? [] : path.split("/")) {
        candidate = join(candidate, segment);
        const stat = await lstat(candidate);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
      }
      const canonicalPath = await realpath(candidate);
      return isInsideRoot(this.#root, canonicalPath) ? canonicalPath : undefined;
    } catch (error: unknown) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  async #readAllowedFile(path: string, skipOversized: boolean): Promise<Buffer | undefined> {
    const segments = path.split("/");
    let candidate = this.#root;
    try {
      for (let index = 0; index < segments.length; index += 1) {
        candidate = join(candidate, segments[index]!);
        const stat = await lstat(candidate);
        if (stat.isSymbolicLink()) {
          throw new HttpError(403, "project_file_forbidden", "Links não fazem parte da área pública do projeto");
        }
        if (index < segments.length - 1 && !stat.isDirectory()) {
          throw new HttpError(404, "project_file_not_found", "Arquivo não encontrado");
        }
      }

      const canonicalPath = await realpath(candidate);
      if (!isInsideRoot(this.#root, canonicalPath)) {
        throw new HttpError(403, "project_file_forbidden", "Arquivo fora da área pública do projeto");
      }

      const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
      const file = await open(canonicalPath, constants.O_RDONLY | noFollow);
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new HttpError(404, "project_file_not_found", "Arquivo não encontrado");
        if (stat.size > MAX_PROJECT_FILE_SIZE_BYTES) {
          if (skipOversized) return undefined;
          throw new HttpError(413, "project_file_too_large", "Arquivo excede o limite de leitura");
        }

        const chunks: Buffer[] = [];
        let total = 0;
        while (total <= MAX_PROJECT_FILE_SIZE_BYTES) {
          const capacity = Math.min(64 * 1_024, MAX_PROJECT_FILE_SIZE_BYTES + 1 - total);
          const chunk = Buffer.allocUnsafe(capacity);
          const { bytesRead } = await file.read(chunk, 0, capacity, total);
          if (bytesRead === 0) break;
          chunks.push(chunk.subarray(0, bytesRead));
          total += bytesRead;
        }
        if (total > MAX_PROJECT_FILE_SIZE_BYTES) {
          if (skipOversized) return undefined;
          throw new HttpError(413, "project_file_too_large", "Arquivo excede o limite de leitura");
        }
        return Buffer.concat(chunks, total);
      } finally {
        await file.close();
      }
    } catch (error: unknown) {
      if (error instanceof HttpError) {
        if (skipOversized && (error.status === 403 || error.status === 404 || error.status === 413)) return undefined;
        throw error;
      }
      if (isMissingFileError(error)) {
        if (skipOversized) return undefined;
        throw new HttpError(404, "project_file_not_found", "Arquivo não encontrado");
      }
      throw error;
    }
  }
}
