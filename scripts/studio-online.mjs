import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDirectory, "..");
const studioServerDirectory = join(projectRoot, "studio-server");
const webDirectory = join(projectRoot, "web");
const localToolsDirectory = join(projectRoot, ".local-tools");
const pagesUrl = process.env.STUDIO_PAGES_URL?.trim()
  || "https://icaropv01.github.io/oficina-do-labirinto/";
const tunnelUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const children = new Set();
let stopping = false;

if (isMainModule()) {
  main().catch(async (error) => {
    await stopChildren();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFalha ao iniciar o Estúdio: ${message}`);
    process.exitCode = 1;
  });
}

async function main() {
  registerShutdownHandlers();

  const { host, port } = await readStudioRuntimeConfig();
  const localServerUrl = loopbackServerUrl(host, port);

  console.log("Preparando o Estúdio e verificando a IA privada...");
  if (await healthyStudio(localServerUrl)) {
    throw new Error(
      `já existe um Studio Server ativo na porta ${port}. Feche a outra janela antes de usar o iniciador online.`,
    );
  }
  const studioServer = startStudioServer();
  await waitForStudio(localServerUrl, studioServer);

  const health = await readHealth(localServerUrl);
  if (!health.aiConfigured) {
    throw new Error(
      "a chave local da Verboo não foi encontrada. O arquivo studio-server/.env.local precisa permanecer neste computador.",
    );
  }

  console.log("IA pronta. Abrindo uma conexão HTTPS temporária para o celular...");
  const cloudflared = await resolveCloudflared();
  const tunnelConnection = await startQuickTunnel(cloudflared, localServerUrl);
  const { child: tunnel, publicUrl } = tunnelConnection;
  console.log(`Endereço HTTPS obtido: ${publicUrl}. Confirmando acesso externo...`);
  await waitForPublicStudio(
    publicUrl,
    new URL(pagesUrl).origin,
    tunnel,
    tunnelConnection.diagnostic,
  );

  if (process.argv.includes("--verify-only")) {
    console.log(`\nTúnel público verificado em ${publicUrl}`);
    console.log("Nenhum convite foi criado no modo de verificação. Pressione Ctrl+C para encerrar.\n");
    await waitForOnlineProcesses(tunnel, studioServer);
    return;
  }

  const localUi = startLocalStudioUi();
  const localUiUrl = "http://127.0.0.1:4173/";
  await waitForLocalStudioUi(localUiUrl, localUi);
  const ownerToken = await createOwnerInvite();
  const ownerUrl = buildOwnerStudioUrl(
    localUiUrl,
    localServerUrl,
    publicUrl,
    pagesUrl,
    ownerToken,
  );
  const opened = await openBrowser(ownerUrl);
  const copied = opened ? false : await copyToClipboard(ownerUrl);

  console.log(`\nEstúdio online em ${publicUrl}`);
  console.log(
    opened
      ? "A página do proprietário foi aberta. Use “Convidar amigo” dentro do Estúdio para gerar o link dele."
      : copied
        ? "O link privado do proprietário foi copiado. Cole-o no navegador deste computador."
        : "O navegador e a área de transferência não puderam ser abertos automaticamente.",
  );
  if (!opened && !copied) {
    console.log("Abra manualmente este link privado do proprietário:");
    console.log(ownerUrl);
  }
  console.log("Mantenha esta janela aberta. Pressione Ctrl+C para desligar o acesso online.\n");

  await waitForOnlineProcesses(tunnel, studioServer, localUi);
}

async function readStudioRuntimeConfig() {
  const envPath = join(projectRoot, "studio-server", ".env.local");
  try {
    const contents = await readFile(envPath, "utf8");
    return studioRuntimeConfigFromEnv(contents, process.env);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return studioRuntimeConfigFromEnv("", process.env);
    }
    throw error;
  }
}

function startStudioServer() {
  const child = spawn(process.execPath, studioNodeArguments("src/index.ts"), {
    cwd: studioServerDirectory,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function startLocalStudioUi() {
  const viteEntryPoint = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteEntryPoint, "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
    {
      cwd: webDirectory,
      env: { ...localUiEnvironment(), NODE_ENV: "development" },
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    },
  );
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForLocalStudioUi(url, localUi) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (localUi.exitCode !== null || localUi.signalCode !== null) {
      throw new Error("a interface local encerrou antes de ficar pronta");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.text()).includes('id="app"')) return;
    } catch {
      // Vite can take a few seconds to transform the first local request.
    }
    await delay(250);
  }
  throw new Error("a interface local do Estúdio não ficou pronta em 20 segundos");
}

async function healthyStudio(baseUrl) {
  try {
    await readHealth(baseUrl);
    return true;
  } catch {
    return false;
  }
}

async function readHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`servidor respondeu HTTP ${response.status}`);
  return parseStudioHealth(await response.json());
}

async function waitForStudio(baseUrl, studioServer) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await healthyStudio(baseUrl)) return;
    if (studioServer.exitCode !== null || studioServer.signalCode !== null) {
      throw new Error("o Studio Server encerrou antes de ficar pronto");
    }
    await delay(250);
  }
  throw new Error("o Studio Server não ficou pronto em 25 segundos");
}

async function resolveCloudflared() {
  const configuredPath = process.env.CLOUDFLARED_PATH?.trim();
  if (configuredPath) {
    await assertExecutable(configuredPath);
    return configuredPath;
  }

  const assetName = cloudflaredAssetName();
  const localPath = join(
    localToolsDirectory,
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  try {
    await assertVerifiedCachedBinary(localPath);
    return localPath;
  } catch {
    // The verified official binary is downloaded only on the first launch.
  }

  console.log("Baixando o conector oficial Cloudflare Tunnel (somente na primeira vez)...");
  await mkdir(localToolsDirectory, { recursive: true });
  const release = await fetchJson(
    "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
  );
  const asset = release.assets?.find((candidate) => candidate?.name === assetName);
  if (!asset?.browser_download_url || typeof release.body !== "string") {
    throw new Error(`a versão atual do cloudflared não oferece ${assetName}`);
  }

  const expectedDigest = checksumFromReleaseBody(release.body, assetName);
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "oficina-do-labirinto-studio" },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`download do cloudflared respondeu HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== expectedDigest) {
    throw new Error("o checksum do cloudflared não corresponde à publicação oficial");
  }

  const temporaryPath = `${localPath}.download`;
  await writeFile(temporaryPath, bytes, { mode: 0o755 });
  await rm(localPath, { force: true });
  await rename(temporaryPath, localPath);
  await writeFile(`${localPath}.sha256`, `${actualDigest}\n`, "utf8");
  if (process.platform !== "win32") await chmod(localPath, 0o755);
  await assertExecutable(localPath);
  return localPath;
}

export function cloudflaredAssetName(platform = process.platform, architecture = process.arch) {
  if (platform === "win32" && architecture === "x64") {
    return "cloudflared-windows-amd64.exe";
  }
  if (platform === "linux" && architecture === "x64") {
    return "cloudflared-linux-amd64";
  }
  if (platform === "linux" && architecture === "arm64") {
    return "cloudflared-linux-arm64";
  }
  throw new Error(`sistema ainda não suportado pelo iniciador (${platform}/${architecture})`);
}

export function checksumFromReleaseBody(body, assetName) {
  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[ \\t]*${escapedName}:[ \\t]*([a-f0-9]{64})[ \\t]*$`, "im").exec(body);
  if (!match) throw new Error(`a publicação oficial não informou o checksum de ${assetName}`);
  return match[1].toLowerCase();
}

async function assertExecutable(path) {
  await access(path, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
}

async function assertVerifiedCachedBinary(path) {
  await assertExecutable(path);
  const expectedDigest = (await readFile(`${path}.sha256`, "utf8")).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error("checksum local ausente ou inválido");
  }
  const actualDigest = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actualDigest !== expectedDigest) {
    throw new Error("o conector Cloudflare local foi alterado ou corrompido");
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "oficina-do-labirinto-studio",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}`);
  return response.json();
}

function startQuickTunnel(executable, localServerUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      executable,
      ["tunnel", "--url", localServerUrl, "--no-autoupdate", "--loglevel", "info"],
      { cwd: projectRoot, env: tunnelEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    children.add(child);
    child.once("exit", () => children.delete(child));
    let combinedOutput = "";
    let settled = false;
    const timeout = setTimeout(
      () => fail("o Cloudflare Tunnel não entregou uma URL em 30 segundos"),
      30_000,
    );

    const inspect = (chunk) => {
      combinedOutput = `${combinedOutput}${chunk.toString("utf8")}`.slice(-16_384);
      const match = tunnelUrlPattern.exec(combinedOutput);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({
        child,
        publicUrl: match[0],
        diagnostic: () => tunnelFailureMessage("Diagnóstico do Cloudflare", combinedOutput),
      });
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code) => {
      if (!settled) fail(`cloudflared encerrou antes de conectar (código ${code ?? "desconhecido"})`);
    });

    function fail(message) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      rejectPromise(new Error(tunnelFailureMessage(message, combinedOutput)));
    }
  });
}

async function createOwnerInvite() {
  const output = await captureCommand(process.execPath, [
    ...studioNodeArguments("src/cli/create-invite.ts"),
    "--role",
    "owner",
    "--hours",
    "24",
  ]);
  return ownerTokenFromCommandOutput(output);
}

function captureCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: studioServerDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(stderr.trim() || `${command} encerrou com código ${code}`));
    });
  });
}

export function buildInvitationUrl(publicServerUrl, token, publicPagesUrl = pagesUrl) {
  const normalizedToken = token.trim();
  if (normalizedToken !== token || normalizedToken.length < 20 || /\s/u.test(token)) {
    throw new Error("o token local do convite é inválido");
  }
  const serverUrl = new URL(publicServerUrl);
  if (
    serverUrl.protocol !== "https:" ||
    serverUrl.username ||
    serverUrl.password ||
    serverUrl.search ||
    serverUrl.hash ||
    (serverUrl.pathname !== "" && serverUrl.pathname !== "/")
  ) {
    throw new Error("o endereço público do Studio Server precisa ser uma origem HTTPS limpa");
  }
  const url = new URL(publicPagesUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("STUDIO_PAGES_URL precisa usar HTTPS sem credenciais");
  }
  url.searchParams.set("studio", "1");
  url.searchParams.set("studioServer", serverUrl.origin);
  url.hash = new URLSearchParams({ invite: normalizedToken }).toString();
  return url.toString();
}

export function buildOwnerStudioUrl(
  localUiUrl,
  localServerUrl,
  publicServerUrl,
  publicPagesUrl,
  token,
) {
  // Reuse the strict public validation even though the owner connects locally.
  buildInvitationUrl(publicServerUrl, token, publicPagesUrl);
  const uiUrl = new URL(localUiUrl);
  const apiUrl = new URL(localServerUrl);
  if (
    uiUrl.protocol !== "http:" ||
    apiUrl.protocol !== "http:" ||
    !isLoopbackHost(uiUrl.hostname) ||
    !isLoopbackHost(apiUrl.hostname) ||
    uiUrl.username ||
    uiUrl.password ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error("a interface e a API locais precisam permanecer em loopback HTTP");
  }
  uiUrl.searchParams.set("studio", "1");
  uiUrl.searchParams.set("studioServer", apiUrl.origin);
  uiUrl.searchParams.set("publicStudioServer", new URL(publicServerUrl).origin);
  uiUrl.searchParams.set("publicPagesUrl", new URL(publicPagesUrl).toString());
  uiUrl.hash = new URLSearchParams({ invite: token }).toString();
  return uiUrl.toString();
}

async function openBrowser(url) {
  const command = process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  return spawnDetached(command, [url]);
}

async function copyToClipboard(url) {
  if (process.platform !== "win32") return false;
  return new Promise((resolvePromise) => {
    const child = spawn("clip.exe", [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    child.stdin.end(url);
  });
}

function registerShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      console.log("\nDesligando o acesso online...");
      await stopChildren();
      process.exit(0);
    });
  }
}

async function stopChildren() {
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  await delay(100);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function parseStudioHealth(payload) {
  if (
    payload?.status !== "ok" ||
    payload?.service !== "oficina-studio-server" ||
    payload?.apiVersion !== 1 ||
    typeof payload?.aiConfigured !== "boolean"
  ) {
    throw new Error("a porta configurada não pertence ao Studio Server compatível");
  }
  return payload;
}

function waitForOnlineProcesses(tunnel, studioServer, localUi = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const watch = (child, label) => {
      const finish = (code, signal) => {
        if (settled) return;
        settled = true;
        if (stopping) {
          resolvePromise();
          return;
        }
        rejectPromise(new Error(`${label} foi encerrado (${signal ?? code ?? "sem código"})`));
      };
      if (child.exitCode !== null || child.signalCode !== null) {
        finish(child.exitCode, child.signalCode);
        return;
      }
      child.once("exit", finish);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        rejectPromise(new Error(`${label} falhou: ${error.message}`));
      });
    };

    watch(tunnel, "o túnel");
    if (studioServer) watch(studioServer, "o Studio Server");
    if (localUi) watch(localUi, "a interface local");
  });
}

export function studioPortFromEnv(contents, processOverride) {
  const overrides = processOverride === undefined
    ? {}
    : { STUDIO_PORT: processOverride };
  return studioRuntimeConfigFromEnv(contents, overrides).port;
}

export function studioRuntimeConfigFromEnv(contents, processEnvironment = {}) {
  const fileEnvironment = parseEnv(contents);
  const host = environmentValue(
    processEnvironment.STUDIO_HOST,
    fileEnvironment.STUDIO_HOST,
    "127.0.0.1",
  ).toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("STUDIO_HOST deve permanecer em loopback (127.0.0.1, localhost ou ::1)");
  }
  const portText = environmentValue(
    processEnvironment.STUDIO_PORT,
    fileEnvironment.STUDIO_PORT,
    "8787",
  );
  if (!/^\d+$/.test(portText)) {
    throw new Error("STUDIO_PORT inválida no arquivo local");
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("STUDIO_PORT inválida no arquivo local");
  }
  const databasePath = environmentValue(
    processEnvironment.STUDIO_DATABASE_PATH,
    fileEnvironment.STUDIO_DATABASE_PATH,
    "./data/studio.sqlite",
  );
  if (databasePath === ":memory:") {
    throw new Error("o iniciador online exige um banco persistente, não STUDIO_DATABASE_PATH=:memory:");
  }
  return { host, port, databasePath };
}

export function ownerTokenFromCommandOutput(output) {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("não foi possível ler o convite local do proprietário");
  }
  const payload = JSON.parse(output.slice(firstBrace, lastBrace + 1));
  if (typeof payload.token !== "string" || payload.token.length < 20) {
    throw new Error("o servidor não devolveu um convite válido");
  }
  return payload.token;
}

export function studioNodeArguments(entryPoint) {
  return ["--env-file-if-exists=.env.local", "--import", "tsx", entryPoint];
}

export function localUiEnvironment(source = process.env) {
  const allowedNames = new Set([
    "path",
    "pathext",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "tmpdir",
    "lang",
    "lc_all",
    "ssl_cert_file",
    "ssl_cert_dir",
  ]);
  const result = {};
  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase();
    if (value !== undefined && allowedNames.has(normalizedName)) {
      result[name] = value;
    }
  }
  return result;
}

export function tunnelEnvironment(source = process.env) {
  const result = localUiEnvironment(source);
  const proxyNames = new Set(["http_proxy", "https_proxy", "all_proxy"]);
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      proxyNames.has(name.toLowerCase()) &&
      safeTunnelProxyUrl(value)
    ) {
      result[name] = value;
    }
  }
  return result;
}

function safeTunnelProxyUrl(value) {
  try {
    const proxy = new URL(value);
    return (
      (proxy.protocol === "http:" || proxy.protocol === "https:") &&
      !proxy.username &&
      !proxy.password &&
      !proxy.search &&
      !proxy.hash &&
      (proxy.pathname === "" || proxy.pathname === "/")
    );
  } catch {
    return false;
  }
}

export function tunnelFailureMessage(summary, output) {
  const lastLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) return summary;
  const sanitized = lastLine
    .replace(/https?:\/\/\S+/giu, "[endereço removido]")
    .replace(/(?:token|secret|password|key)\s*[=:]\s*\S+/giu, "credencial=[removida]")
    .slice(0, 240);
  return `${summary}. Último diagnóstico: ${sanitized}`;
}

async function waitForPublicStudio(publicUrl, pagesOrigin, tunnel, tunnelDiagnostic) {
  const deadline = Date.now() + 60_000;
  let lastError = "o endereço público ainda não respondeu";
  while (Date.now() < deadline) {
    if (tunnel.exitCode !== null || tunnel.signalCode !== null) {
      throw new Error("o túnel encerrou antes de ficar acessível pela internet");
    }
    try {
      const response = await requestPublicHealth(`${publicUrl}/health`, pagesOrigin);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      parseStudioHealth(response.payload);
      if (
        response.allowOrigin !== pagesOrigin ||
        response.allowCredentials !== "true"
      ) {
        throw new Error("CORS do GitHub Pages não foi confirmado");
      }
      return;
    } catch (error) {
      lastError = networkErrorMessage(error);
    }
    await delay(500);
  }
  throw new Error(
    `o túnel não ficou pronto em 60 segundos: ${lastError}. ${tunnelDiagnostic()}`,
  );
}

async function requestPublicHealth(url, pagesOrigin) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Origin: pagesOrigin },
      signal: AbortSignal.timeout(4_000),
    });
    return {
      status: response.status,
      payload: await response.json(),
      allowOrigin: response.headers.get("access-control-allow-origin"),
      allowCredentials: response.headers.get("access-control-allow-credentials"),
    };
  } catch (directError) {
    const hostname = new URL(url).hostname;
    const address = await resolvePublicAddressWithDoh(hostname);
    try {
      return await requestPublicHealthAtAddress(url, pagesOrigin, address);
    } catch (dohError) {
      throw new Error(
        `${networkErrorMessage(directError)}; fallback DoH: ${networkErrorMessage(dohError)}`,
      );
    }
  }
}

export async function resolvePublicAddressWithDoh(hostname, fetchImplementation = fetch) {
  const resolverUrls = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
  ];
  const attempts = resolverUrls.map(async (resolverUrl) => {
    const url = new URL(resolverUrl);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", "A");
    const response = await fetchImplementation(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`DNS-over-HTTPS respondeu HTTP ${response.status}`);
    return addressFromDohResponse(await response.json());
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("DNS-over-HTTPS não confirmou o endereço do túnel em nenhum resolvedor");
  }
}

export function addressFromDohResponse(payload) {
  if (payload?.Status !== 0 || !Array.isArray(payload.Answer)) {
    throw new Error("DNS-over-HTTPS não confirmou o endereço do túnel");
  }
  const address = payload.Answer.find(
    (answer) => answer?.type === 1 && typeof answer.data === "string" && isIP(answer.data) === 4,
  )?.data;
  if (!address) throw new Error("DNS-over-HTTPS não devolveu um IPv4 válido para o túnel");
  return address;
}

function requestPublicHealthAtAddress(url, pagesOrigin, address) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest(
      new URL(url),
      {
        headers: { Accept: "application/json", Origin: pagesOrigin },
        lookup: fixedAddressLookup(address),
        timeout: 4_000,
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;
        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 64 * 1024) {
            request.destroy(new Error("health público excedeu 64 KiB"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          try {
            resolvePromise({
              status: response.statusCode ?? 0,
              payload: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              allowOrigin: response.headers["access-control-allow-origin"] ?? null,
              allowCredentials: response.headers["access-control-allow-credentials"] ?? null,
            });
          } catch (error) {
            rejectPromise(error);
          }
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("health público expirou")));
    request.once("error", rejectPromise);
    request.end();
  });
}

export function fixedAddressLookup(address) {
  const family = isIP(address);
  if (family === 0) throw new Error("endereço DoH inválido para a conexão HTTPS");
  return (_hostname, options, callback) => {
    // Node 24 enables automatic family selection and requests every address.
    // Older/explicit modes still use the legacy address + family callback.
    if (options?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

function spawnDetached(command, args) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolvePromise(false);
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (result) child.unref();
      resolvePromise(result);
    };
    child.once("spawn", () => finish(true));
    child.once("error", () => finish(false));
  });
}

function environmentValue(processValue, fileValue, fallback) {
  const selected = processValue ?? fileValue;
  return selected?.trim() || fallback;
}

export function networkErrorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (typeof cause === "object" && cause !== null) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    const message = "message" in cause && typeof cause.message === "string"
      ? cause.message.replace(/https?:\/\/\S+/giu, "[endereço removido]")
      : null;
    if (code || message) return [error.message, code, message].filter(Boolean).join(" — ");
  }
  return error.message;
}

export function loopbackServerUrl(host, port) {
  const urlHost = host === "::1" ? "[::1]" : host;
  return `http://${urlHost}:${port}`;
}

function isLoopbackHost(hostname) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname.toLowerCase());
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
