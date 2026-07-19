import { z } from "zod";
import {
  IsoDateTimeSchema,
  Sha256Schema,
  StudioIdSchema,
} from "./primitives.js";

/**
 * File exploration is deliberately bounded. The browser is a reading aid, not
 * a general-purpose filesystem API, so one response can never make the old
 * home server load an arbitrarily large file into memory.
 */
export const MAX_PROJECT_FILE_SIZE_BYTES = 1024 * 1024;
export const MAX_PROJECT_FILES_PER_MANIFEST = 512;

const MAX_PROJECT_FILE_PATH_LENGTH = 512;
const MAX_PROJECT_FILE_NAME_LENGTH = 160;
const MAX_BASE64_CONTENT_LENGTH =
  Math.ceil(MAX_PROJECT_FILE_SIZE_BYTES / 3) * 4;

const SENSITIVE_EXACT_SEGMENTS = new Set([
  ".aws",
  ".azure",
  ".direnv",
  ".envrc",
  ".git",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".ssh",
  "credentials",
  "credential",
  "secrets",
  "secret",
]);

function sensitivePathSegmentReason(segment: string): string | null {
  const normalized = segment.toLowerCase();

  if (SENSITIVE_EXACT_SEGMENTS.has(normalized)) {
    return "sensitive path segment";
  }
  if (normalized === ".env" || normalized.startsWith(".env.")) {
    return "environment file";
  }
  if (
    /(?:^|[._-])(?:secret|secrets|credential|credentials)(?:[._-]|$)/.test(
      normalized,
    )
  ) {
    return "credential-like filename";
  }
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(normalized)) {
    return "private-key filename";
  }
  if (/\.(?:key|pem|p12|pfx|jks|keystore)$/.test(normalized)) {
    return "private-key container";
  }
  if (/\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/.test(normalized)) {
    return "database file";
  }

  return null;
}

/**
 * A safe project path is already normalized POSIX-style and remains relative
 * to the configured project root. This is defense in depth: the server must
 * still resolve and containment-check every requested path before reading it.
 */
export const ProjectFilePathSchema = z
  .string()
  .min(1)
  .max(MAX_PROJECT_FILE_PATH_LENGTH)
  .superRefine((path, context) => {
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
      context.addIssue({
        code: "custom",
        message: "Project file paths must be relative.",
      });
    }
    if (path.includes("\\")) {
      context.addIssue({
        code: "custom",
        message: "Project file paths must use forward slashes.",
      });
    }
    if (/[\u0000-\u001f\u007f]/.test(path)) {
      context.addIssue({
        code: "custom",
        message: "Project file paths cannot contain control characters.",
      });
    }

    const segments = path.split("/");
    for (const [index, segment] of segments.entries()) {
      if (segment.length === 0 || segment === "." || segment === "..") {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Project file paths must be normalized without empty, dot or parent segments.",
        });
        continue;
      }
      if (segment.trim() !== segment) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Project file path segments cannot have surrounding whitespace.",
        });
      }

      const sensitiveReason = sensitivePathSegmentReason(segment);
      if (sensitiveReason !== null) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Project file paths cannot expose a ${sensitiveReason}.`,
        });
      }
    }
  });
export type ProjectFilePath = z.infer<typeof ProjectFilePathSchema>;

export const ProjectFileNameSchema = z
  .string()
  .min(1)
  .max(MAX_PROJECT_FILE_NAME_LENGTH)
  .refine(
    (name) =>
      name.trim() === name &&
      !name.includes("/") &&
      !name.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(name),
    "Project file names must be a single safe path segment.",
  );
export type ProjectFileName = z.infer<typeof ProjectFileNameSchema>;

export const ProjectFileCategorySchema = z.enum([
  "source",
  "game-data",
  "documentation",
  "asset",
  "configuration",
]);
export type ProjectFileCategory = z.infer<typeof ProjectFileCategorySchema>;

export const ProjectFileKindSchema = z.enum(["text", "image"]);
export type ProjectFileKind = z.infer<typeof ProjectFileKindSchema>;

export const ProjectFileEncodingSchema = z.enum(["utf8", "base64"]);
export type ProjectFileEncoding = z.infer<typeof ProjectFileEncodingSchema>;

export const ProjectFileTextMediaTypeSchema = z.enum([
  "text/plain",
  "text/markdown",
  "text/typescript",
  "text/javascript",
  "text/css",
  "text/html",
  "text/x-python",
  "text/x-shellscript",
  "application/json",
  "application/manifest+json",
  "application/yaml",
  "application/toml",
  // SVG stays text so clients show its source and never treat active markup as a safe bitmap.
  "image/svg+xml",
]);
export type ProjectFileTextMediaType = z.infer<
  typeof ProjectFileTextMediaTypeSchema
>;

export const ProjectFileImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export type ProjectFileImageMediaType = z.infer<
  typeof ProjectFileImageMediaTypeSchema
>;

export const ProjectFileMediaTypeSchema = z.union([
  ProjectFileTextMediaTypeSchema,
  ProjectFileImageMediaTypeSchema,
]);
export type ProjectFileMediaType = z.infer<
  typeof ProjectFileMediaTypeSchema
>;

const ProjectFileEntryBaseShape = {
  path: ProjectFilePathSchema,
  name: ProjectFileNameSchema,
  category: ProjectFileCategorySchema,
  sha256: Sha256Schema,
} as const;

export const ProjectTextFileEntrySchema = z
  .object({
    ...ProjectFileEntryBaseShape,
    kind: z.literal("text"),
    mediaType: ProjectFileTextMediaTypeSchema,
    sizeBytes: z.number().int().min(0).max(MAX_PROJECT_FILE_SIZE_BYTES),
  })
  .strict();
export type ProjectTextFileEntry = z.infer<
  typeof ProjectTextFileEntrySchema
>;

export const ProjectImageFileEntrySchema = z
  .object({
    ...ProjectFileEntryBaseShape,
    kind: z.literal("image"),
    mediaType: ProjectFileImageMediaTypeSchema,
    sizeBytes: z.number().int().min(1).max(MAX_PROJECT_FILE_SIZE_BYTES),
  })
  .strict();
export type ProjectImageFileEntry = z.infer<
  typeof ProjectImageFileEntrySchema
>;

export const ProjectFileEntrySchema = z
  .discriminatedUnion("kind", [
    ProjectTextFileEntrySchema,
    ProjectImageFileEntrySchema,
  ])
  .superRefine((entry, context) => {
    const expectedName = entry.path.split("/").at(-1);
    if (entry.name !== expectedName) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "The file name must match the final path segment.",
      });
    }
  });
export type ProjectFileEntry = z.infer<typeof ProjectFileEntrySchema>;

/**
 * The digest covers canonical JSON (RFC 8785) of
 * `{ schemaVersion: 1, projectId, files }`. `generatedAt` and the digest itself
 * are excluded, while `files` must be sorted by path for a stable snapshot.
 */
export const ProjectFileManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: StudioIdSchema,
    generatedAt: IsoDateTimeSchema,
    manifestDigest: Sha256Schema,
    files: z
      .array(ProjectFileEntrySchema)
      .max(MAX_PROJECT_FILES_PER_MANIFEST),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (let index = 1; index < manifest.files.length; index += 1) {
      const previousPath = manifest.files[index - 1]?.path;
      const currentPath = manifest.files[index]?.path;
      if (
        previousPath !== undefined &&
        currentPath !== undefined &&
        previousPath >= currentPath
      ) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: "Manifest file paths must be unique and sorted.",
        });
      }
    }
  });
export type ProjectFileManifest = z.infer<typeof ProjectFileManifestSchema>;

const CanonicalBase64Schema = z
  .string()
  .max(MAX_BASE64_CONTENT_LENGTH)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "Image content must be canonical base64.",
  );

const ProjectTextFileContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: StudioIdSchema,
    entry: ProjectTextFileEntrySchema,
    encoding: z.literal("utf8"),
    content: z.string().max(MAX_PROJECT_FILE_SIZE_BYTES),
  })
  .strict();

const ProjectImageFileContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: StudioIdSchema,
    entry: ProjectImageFileEntrySchema,
    encoding: z.literal("base64"),
    content: CanonicalBase64Schema,
  })
  .strict();

function decodedBase64Bytes(content: string): number {
  if (content.length === 0) return 0;
  const paddingBytes = content.endsWith("==")
    ? 2
    : content.endsWith("=")
      ? 1
      : 0;
  return (content.length / 4) * 3 - paddingBytes;
}

export const ProjectFileContentSchema = z
  .discriminatedUnion("encoding", [
    ProjectTextFileContentSchema,
    ProjectImageFileContentSchema,
  ])
  .superRefine((file, context) => {
    const expectedName = file.entry.path.split("/").at(-1);
    if (file.entry.name !== expectedName) {
      context.addIssue({
        code: "custom",
        path: ["entry", "name"],
        message: "The file name must match the final path segment.",
      });
    }

    const contentBytes =
      file.encoding === "utf8"
        ? new TextEncoder().encode(file.content).byteLength
        : decodedBase64Bytes(file.content);

    if (contentBytes !== file.entry.sizeBytes) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "The encoded content size must match the manifest entry.",
      });
    }
  });
export type ProjectFileContent = z.infer<typeof ProjectFileContentSchema>;

export function parseProjectFileManifest(
  value: unknown,
): ProjectFileManifest {
  return ProjectFileManifestSchema.parse(value);
}

export function parseProjectFileContent(value: unknown): ProjectFileContent {
  return ProjectFileContentSchema.parse(value);
}
