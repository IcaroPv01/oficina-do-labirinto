import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_PROJECT_FILE_SIZE_BYTES,
  ProjectFileContentSchema,
  ProjectFileManifestSchema,
} from "@collaborative-roguelike/studio-contracts";
import { digestCanonicalJson } from "../src/canonical-json.js";
import { loadConfig } from "../src/config.js";
import { createStudioServer } from "../src/server.js";

const localOrigin = "http://127.0.0.1:4173";

interface TestWorkspace {
  readonly root: string;
  readonly mainSource: string;
  readonly image: Buffer;
}

async function makeWorkspace(): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "oficina-project-files-"));
  await Promise.all([
    mkdir(join(root, "web", "src"), { recursive: true }),
    mkdir(join(root, "web", "public"), { recursive: true }),
    mkdir(join(root, "web", "scripts"), { recursive: true }),
    mkdir(join(root, "src"), { recursive: true }),
    mkdir(join(root, "studio-server"), { recursive: true }),
    mkdir(join(root, "game-data"), { recursive: true }),
    mkdir(join(root, "docs"), { recursive: true }),
    mkdir(join(root, ".git"), { recursive: true }),
  ]);
  const mainSource = "export const title = \"Oficina do Labirinto\";\n";
  const image = Buffer.from("89504e470d0a1a0a00000000", "hex");
  await Promise.all([
    writeFile(join(root, "README.md"), "# Projeto real\n", "utf8"),
    writeFile(join(root, "src", "legacy.py"), "print('legado')\n", "utf8"),
    writeFile(join(root, "studio-server", "package.json"), "{\"private\":true}\n", "utf8"),
    writeFile(join(root, "studio-server", ".env.example"), "VERBOO_API_KEY=do-not-list", "utf8"),
    writeFile(join(root, "web", "package.json"), "{\"private\":true}\n", "utf8"),
    writeFile(join(root, "web", "scripts", "validate.ts"), "export const valid = true;\n", "utf8"),
    writeFile(join(root, "web", "src", "main.ts"), mainSource, "utf8"),
    writeFile(join(root, "web", "src", ".env"), "VERBOO_API_KEY=never-return-this", "utf8"),
    writeFile(join(root, "web", "src", "too-large.ts"), Buffer.alloc(MAX_PROJECT_FILE_SIZE_BYTES + 1, 97)),
    writeFile(join(root, "web", "public", "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n", "utf8"),
    writeFile(join(root, "web", "public", "manifest.webmanifest"), "{\"name\":\"Oficina\"}\n", "utf8"),
    writeFile(join(root, "game-data", "default-project.json"), "{\"version\":1}\n", "utf8"),
    writeFile(join(root, "docs", "sprite.png"), image),
    writeFile(join(root, ".git", "config"), "private repository metadata", "utf8"),
  ]);
  return { root, mainSource, image };
}

test("project file API returns only deterministic, hashed allowlisted files", async () => {
  const workspace = await makeWorkspace();
  const config = loadConfig({
    STUDIO_HOST: "127.0.0.1",
    STUDIO_PORT: "0",
    STUDIO_DATABASE_PATH: ":memory:",
    STUDIO_PROJECT_ROOT: workspace.root,
    // The checkout's local Vite origin is added safely even when deployment CORS has only Pages.
    STUDIO_CORS_ORIGINS: "https://icaropv01.github.io",
    STUDIO_COOKIE_SECURE: "false",
    STUDIO_COOKIE_SAME_SITE: "lax",
    STUDIO_DEV_AUTH_ENABLED: "true",
  });
  const studio = createStudioServer(config);
  const address = await studio.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const denied = await jsonRequest(`${baseUrl}/api/projects/unknown/files`, { headers: { origin: localOrigin } });
    assert.equal(denied.response.status, 401);
    assert.equal(errorCode(denied.body), "authentication_required");

    const login = await jsonRequest(`${baseUrl}/auth/dev`, {
      method: "POST",
      headers: { origin: localOrigin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Leitor" }),
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const csrf = (login.body as { csrfToken: string }).csrfToken;

    const unknownProject = await jsonRequest(`${baseUrl}/api/projects/unknown/files`, {
      headers: { origin: localOrigin, cookie },
    });
    assert.equal(unknownProject.response.status, 404);
    assert.equal(errorCode(unknownProject.body), "project_not_found");

    const created = await jsonRequest(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: authHeaders(cookie, csrf),
      body: JSON.stringify({ name: "Labirinto", explanation: "Projeto de teste", snapshot: { version: 1 } }),
    });
    assert.equal(created.response.status, 201);
    const projectId = (created.body as { project: { id: string } }).project.id;

    const firstManifestResponse = await jsonRequest(`${baseUrl}/api/projects/${projectId}/files`, {
      headers: { origin: localOrigin, cookie },
    });
    assert.equal(firstManifestResponse.response.status, 200, JSON.stringify(firstManifestResponse.body));
    const manifest = ProjectFileManifestSchema.parse(firstManifestResponse.body);
    assert.deepEqual(
      manifest.files.map((entry) => entry.path),
      [
        "README.md",
        "docs/sprite.png",
        "game-data/default-project.json",
        "src/legacy.py",
        "studio-server/package.json",
        "web/package.json",
        "web/public/favicon.svg",
        "web/public/manifest.webmanifest",
        "web/scripts/validate.ts",
        "web/src/main.ts",
      ],
    );
    assert.equal(JSON.stringify(manifest).includes("VERBOO_API_KEY"), false);
    assert.equal(manifest.files.some((entry) => entry.path.includes("too-large")), false);
    assert.equal(
      manifest.manifestDigest,
      digestCanonicalJson({ schemaVersion: 1, projectId, files: manifest.files }).digest,
    );

    const secondManifestResponse = await jsonRequest(`${baseUrl}/api/projects/${projectId}/files`, {
      headers: { origin: localOrigin, cookie },
    });
    const secondManifest = ProjectFileManifestSchema.parse(secondManifestResponse.body);
    assert.equal(secondManifest.manifestDigest, manifest.manifestDigest);

    const sourceResponse = await readContent(baseUrl, projectId, "web/src/main.ts", cookie);
    assert.equal(sourceResponse.response.status, 200);
    const source = ProjectFileContentSchema.parse(sourceResponse.body);
    assert.equal(source.encoding, "utf8");
    assert.equal(source.content, workspace.mainSource);
    assert.equal(source.entry.sha256, createHash("sha256").update(workspace.mainSource).digest("hex"));

    const imageResponse = await readContent(baseUrl, projectId, "docs/sprite.png", cookie);
    assert.equal(imageResponse.response.status, 200);
    const image = ProjectFileContentSchema.parse(imageResponse.body);
    assert.equal(image.encoding, "base64");
    assert.equal(image.content, workspace.image.toString("base64"));
    assert.equal(image.entry.category, "asset");

    const svgResponse = await readContent(baseUrl, projectId, "web/public/favicon.svg", cookie);
    const svg = ProjectFileContentSchema.parse(svgResponse.body);
    assert.equal(svg.encoding, "utf8");
    assert.equal(svg.entry.kind, "text");
    assert.equal(svg.entry.mediaType, "image/svg+xml");
    assert.equal(svg.entry.category, "asset");

    const webManifestResponse = await readContent(baseUrl, projectId, "web/public/manifest.webmanifest", cookie);
    const webManifest = ProjectFileContentSchema.parse(webManifestResponse.body);
    assert.equal(webManifest.encoding, "utf8");
    assert.equal(webManifest.entry.mediaType, "application/manifest+json");

    for (const path of ["../README.md", "web/src/../../README.md", "web\\src\\main.ts", "/README.md"]) {
      const traversal = await readContent(baseUrl, projectId, path, cookie);
      assert.equal(traversal.response.status, 400, path);
      assert.equal(errorCode(traversal.body), "invalid_project_file_path", path);
    }

    const secret = await readContent(baseUrl, projectId, "web/src/.env", cookie);
    assert.equal(secret.response.status, 403);
    assert.equal(errorCode(secret.body), "project_file_forbidden");

    const envExample = await readContent(baseUrl, projectId, "studio-server/.env.example", cookie);
    assert.equal(envExample.response.status, 403);
    assert.equal(errorCode(envExample.body), "project_file_forbidden");

    const gitMetadata = await readContent(baseUrl, projectId, ".git/config", cookie);
    assert.equal(gitMetadata.response.status, 403);
    assert.equal(errorCode(gitMetadata.body), "project_file_forbidden");

    const unsupported = await readContent(baseUrl, projectId, "web/src/program.exe", cookie);
    assert.equal(unsupported.response.status, 403);
    assert.equal(errorCode(unsupported.body), "project_file_forbidden");

    const oversized = await readContent(baseUrl, projectId, "web/src/too-large.ts", cookie);
    assert.equal(oversized.response.status, 413);
    assert.equal(errorCode(oversized.body), "project_file_too_large");

    const missing = await readContent(baseUrl, projectId, "web/src/missing.ts", cookie);
    assert.equal(missing.response.status, 404);
    assert.equal(errorCode(missing.body), "project_file_not_found");

    const missingPath = await jsonRequest(`${baseUrl}/api/projects/${projectId}/files/content`, {
      headers: { origin: localOrigin, cookie },
    });
    assert.equal(missingPath.response.status, 400);
    assert.equal(errorCode(missingPath.body), "invalid_project_file_path");
  } finally {
    await studio.close();
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("project file API rejects symlink and junction escapes when the platform permits creating them", async (context) => {
  const workspace = await makeWorkspace();
  const outside = await mkdtemp(join(tmpdir(), "oficina-project-files-outside-"));
  await writeFile(join(outside, "secret.ts"), "export const stolen = true;\n", "utf8");
  await writeFile(join(outside, "schema.ts"), "export const escaped = true;\n", "utf8");
  try {
    try {
      await symlink(outside, join(workspace.root, "web", "src", "linked"), process.platform === "win32" ? "junction" : "dir");
      await symlink(outside, join(workspace.root, "schemas"), process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EPERM") {
        context.skip("Sistema não permite criar links no diretório temporário");
        return;
      }
      throw error;
    }

    const config = loadConfig({
      STUDIO_HOST: "127.0.0.1",
      STUDIO_PORT: "0",
      STUDIO_DATABASE_PATH: ":memory:",
      STUDIO_PROJECT_ROOT: workspace.root,
      STUDIO_CORS_ORIGINS: localOrigin,
      STUDIO_COOKIE_SECURE: "false",
      STUDIO_COOKIE_SAME_SITE: "lax",
      STUDIO_DEV_AUTH_ENABLED: "true",
    });
    const studio = createStudioServer(config);
    const address = await studio.listen();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const login = await jsonRequest(`${baseUrl}/auth/dev`, {
        method: "POST",
        headers: { origin: localOrigin, "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Leitor" }),
      });
      const cookie = login.response.headers.get("set-cookie")!.split(";", 1)[0]!;
      const csrf = (login.body as { csrfToken: string }).csrfToken;
      const created = await jsonRequest(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: authHeaders(cookie, csrf),
        body: JSON.stringify({ name: "Labirinto", explanation: "Teste de link", snapshot: { version: 1 } }),
      });
      const projectId = (created.body as { project: { id: string } }).project.id;

      const manifestResponse = await jsonRequest(`${baseUrl}/api/projects/${projectId}/files`, {
        headers: { origin: localOrigin, cookie },
      });
      assert.equal(manifestResponse.response.status, 200, JSON.stringify(manifestResponse.body));
      const manifest = ProjectFileManifestSchema.parse(manifestResponse.body);
      assert.equal(manifest.files.some((entry) => entry.path.startsWith("web/src/linked/")), false);
      assert.equal(manifest.files.some((entry) => entry.path.startsWith("schemas/")), false);

      const escaped = await readContent(baseUrl, projectId, "web/src/linked/secret.ts", cookie);
      assert.equal(escaped.response.status, 403);
      assert.equal(errorCode(escaped.body), "project_file_forbidden");

      const escapedAllowedRoot = await readContent(baseUrl, projectId, "schemas/schema.ts", cookie);
      assert.equal(escapedAllowedRoot.response.status, 403);
      assert.equal(errorCode(escapedAllowedRoot.body), "project_file_forbidden");
    } finally {
      await studio.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

function authHeaders(cookie: string, csrf: string): Record<string, string> {
  return { origin: localOrigin, cookie, "x-studio-csrf": csrf, "content-type": "application/json" };
}

async function readContent(baseUrl: string, projectId: string, path: string, cookie: string) {
  const query = new URLSearchParams({ path });
  return await jsonRequest(`${baseUrl}/api/projects/${projectId}/files/content?${query}`, {
    headers: { origin: localOrigin, cookie },
  });
}

function errorCode(value: unknown): string | undefined {
  return (value as { error?: { code?: string } }).error?.code;
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, init);
  return { response, body: (await response.json()) as unknown };
}
