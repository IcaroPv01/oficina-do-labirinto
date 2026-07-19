import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_FILE_SIZE_BYTES,
  ProjectFileContentSchema,
  ProjectFileEntrySchema,
  ProjectFileManifestSchema,
  ProjectFilePathSchema,
} from "./project-files.js";

const TEXT_ENTRY = {
  path: "web/src/main.ts",
  name: "main.ts",
  category: "source",
  kind: "text",
  mediaType: "text/typescript",
  sizeBytes: 5,
  sha256: "a".repeat(64),
} as const;

const IMAGE_ENTRY = {
  path: "assets/player.png",
  name: "player.png",
  category: "asset",
  kind: "image",
  mediaType: "image/png",
  sizeBytes: 4,
  sha256: "b".repeat(64),
} as const;

const MANIFEST = {
  schemaVersion: 1,
  projectId: "project-main",
  generatedAt: "2026-07-18T20:00:00.000Z",
  manifestDigest: "c".repeat(64),
  files: [IMAGE_ENTRY, TEXT_ENTRY],
} as const;

describe("project file paths", () => {
  it("accepts normalized relative project paths", () => {
    expect(ProjectFilePathSchema.parse("web/src/main.ts")).toBe(
      "web/src/main.ts",
    );
    expect(ProjectFilePathSchema.parse(".github/workflows/ci.yml")).toBe(
      ".github/workflows/ci.yml",
    );
  });

  it.each([
    "/etc/passwd",
    "C:/Users/example/key.txt",
    "web\\src\\main.ts",
    "web/../.env",
    "web/./main.ts",
    "web//main.ts",
    "web/src/",
  ])("rejects absolute or non-normalized path %s", (path) => {
    expect(ProjectFilePathSchema.safeParse(path).success).toBe(false);
  });

  it.each([
    ".env",
    ".env.local",
    ".envrc",
    ".direnv/allow",
    ".git/config",
    ".ssh/id_ed25519",
    "config/client-secret.json",
    "certificates/server.pem",
    "studio-server/data/studio.sqlite-wal",
  ])("rejects sensitive path %s", (path) => {
    expect(ProjectFilePathSchema.safeParse(path).success).toBe(false);
  });
});

describe("project file entries and manifests", () => {
  it("accepts bounded text and image metadata", () => {
    expect(ProjectFileEntrySchema.parse(TEXT_ENTRY)).toEqual(TEXT_ENTRY);
    expect(ProjectFileEntrySchema.parse(IMAGE_ENTRY)).toEqual(IMAGE_ENTRY);
    expect(ProjectFileManifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
  });

  it("binds the name and media type to the normalized entry", () => {
    expect(
      ProjectFileEntrySchema.safeParse({ ...TEXT_ENTRY, name: "other.ts" })
        .success,
    ).toBe(false);
    expect(
      ProjectFileEntrySchema.safeParse({
        ...TEXT_ENTRY,
        mediaType: "image/png",
      }).success,
    ).toBe(false);
    expect(
      ProjectFileEntrySchema.safeParse({
        ...IMAGE_ENTRY,
        kind: "text",
      }).success,
    ).toBe(false);
  });

  it("limits file size and rejects unknown fields", () => {
    expect(
      ProjectFileEntrySchema.safeParse({
        ...TEXT_ENTRY,
        sizeBytes: MAX_PROJECT_FILE_SIZE_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      ProjectFileEntrySchema.safeParse({ ...TEXT_ENTRY, absolutePath: "no" })
        .success,
    ).toBe(false);
  });

  it("bounds the number of files carried by one manifest response", () => {
    const files = Array.from({ length: 513 }, (_, index) => {
      const name = `file-${index.toString().padStart(3, "0")}.ts`;
      return {
        ...TEXT_ENTRY,
        path: `web/src/${name}`,
        name,
      };
    });
    expect(
      ProjectFileManifestSchema.safeParse({ ...MANIFEST, files }).success,
    ).toBe(false);
  });

  it("requires unique, sorted paths in a strict manifest", () => {
    expect(
      ProjectFileManifestSchema.safeParse({
        ...MANIFEST,
        files: [TEXT_ENTRY, IMAGE_ENTRY],
      }).success,
    ).toBe(false);
    expect(
      ProjectFileManifestSchema.safeParse({
        ...MANIFEST,
        files: [IMAGE_ENTRY, IMAGE_ENTRY],
      }).success,
    ).toBe(false);
    expect(
      ProjectFileManifestSchema.safeParse({ ...MANIFEST, root: "C:/repo" })
        .success,
    ).toBe(false);
  });
});

describe("project file content", () => {
  it("accepts UTF-8 text and canonical base64 with matching byte counts", () => {
    const textContent = {
      schemaVersion: 1,
      projectId: "project-main",
      entry: TEXT_ENTRY,
      encoding: "utf8",
      content: "hello",
    } as const;
    const imageContent = {
      schemaVersion: 1,
      projectId: "project-main",
      entry: IMAGE_ENTRY,
      encoding: "base64",
      content: "iVBORw==",
    } as const;

    expect(ProjectFileContentSchema.parse(textContent)).toEqual(textContent);
    expect(ProjectFileContentSchema.parse(imageContent)).toEqual(imageContent);
  });

  it("keeps SVG in the UTF-8 text boundary instead of the renderable image boundary", () => {
    const content = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
    const svgEntry = {
      ...TEXT_ENTRY,
      path: "web/public/favicon.svg",
      name: "favicon.svg",
      category: "asset",
      mediaType: "image/svg+xml",
      sizeBytes: new TextEncoder().encode(content).byteLength,
    } as const;
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: svgEntry,
        encoding: "utf8",
        content,
      }).success,
    ).toBe(true);
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: svgEntry,
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      }).success,
    ).toBe(false);
  });

  it("measures Unicode text as UTF-8 bytes", () => {
    const content = "ação";
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: {
          ...TEXT_ENTRY,
          sizeBytes: new TextEncoder().encode(content).byteLength,
        },
        encoding: "utf8",
        content,
      }).success,
    ).toBe(true);
  });

  it("rejects encoding-kind mismatches, malformed base64 and size lies", () => {
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: IMAGE_ENTRY,
        encoding: "utf8",
        content: "iVBORw==",
      }).success,
    ).toBe(false);
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: IMAGE_ENTRY,
        encoding: "base64",
        content: "not base64!",
      }).success,
    ).toBe(false);
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: { ...TEXT_ENTRY, sizeBytes: 4 },
        encoding: "utf8",
        content: "hello",
      }).success,
    ).toBe(false);
    expect(
      ProjectFileContentSchema.safeParse({
        schemaVersion: 1,
        projectId: "project-main",
        entry: { ...TEXT_ENTRY, name: "other.ts" },
        encoding: "utf8",
        content: "hello",
      }).success,
    ).toBe(false);
  });
});
