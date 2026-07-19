import assert from "node:assert/strict";
import test from "node:test";
import {
  addressFromDohResponse,
  buildInvitationUrl,
  buildOwnerStudioUrl,
  checksumFromReleaseBody,
  cloudflaredAssetName,
  fixedAddressLookup,
  localUiEnvironment,
  ownerTokenFromCommandOutput,
  loopbackServerUrl,
  networkErrorMessage,
  parseStudioHealth,
  resolvePublicAddressWithDoh,
  studioNodeArguments,
  studioPortFromEnv,
  studioRuntimeConfigFromEnv,
  tunnelEnvironment,
  tunnelFailureMessage,
} from "./studio-online.mjs";

test("o convite usa Pages, servidor público na busca e credencial somente no fragmento", () => {
  const token = "convite-unico-com-mais-de-vinte-caracteres";
  const invitation = new URL(buildInvitationUrl(
    "https://safe-tunnel.trycloudflare.com",
    token,
    "https://example.github.io/oficina/",
  ));

  assert.equal(invitation.origin, "https://example.github.io");
  assert.equal(invitation.pathname, "/oficina/");
  assert.equal(invitation.searchParams.get("studio"), "1");
  assert.equal(
    invitation.searchParams.get("studioServer"),
    "https://safe-tunnel.trycloudflare.com",
  );
  assert.equal(invitation.searchParams.has("invite"), false);
  assert.equal(new URLSearchParams(invitation.hash.slice(1)).get("invite"), token);
});

test("o dono abre UI e API locais mas compartilha Pages com o servidor público", () => {
  const token = "owner-token-de-uso-unico-123456";
  const ownerUrl = new URL(buildOwnerStudioUrl(
    "http://127.0.0.1:4173/",
    "http://127.0.0.1:8787",
    "https://safe-tunnel.trycloudflare.com",
    "https://example.github.io/oficina/",
    token,
  ));
  assert.equal(ownerUrl.origin, "http://127.0.0.1:4173");
  assert.equal(ownerUrl.searchParams.get("studioServer"), "http://127.0.0.1:8787");
  assert.equal(
    ownerUrl.searchParams.get("publicStudioServer"),
    "https://safe-tunnel.trycloudflare.com",
  );
  assert.equal(
    ownerUrl.searchParams.get("publicPagesUrl"),
    "https://example.github.io/oficina/",
  );
  assert.equal(new URLSearchParams(ownerUrl.hash.slice(1)).get("invite"), token);
  assert.throws(
    () => buildOwnerStudioUrl(
      "http://192.168.1.10:4173",
      "http://127.0.0.1:8787",
      "https://safe.example",
      "https://pages.example",
      token,
    ),
    /loopback/,
  );
});

test("o iniciador recusa uma origem pública sem HTTPS", () => {
  assert.throws(
    () => buildInvitationUrl("https://safe.example", "x".repeat(24), "http://pages.example"),
    /HTTPS/,
  );
  assert.throws(
    () => buildInvitationUrl("https://user@safe.example", "x".repeat(24)),
    /origem HTTPS limpa/,
  );
  assert.throws(
    () => buildInvitationUrl("https://safe.example/?token=leak", "x".repeat(24)),
    /origem HTTPS limpa/,
  );
  assert.throws(
    () => buildInvitationUrl("https://safe.example", ` ${"x".repeat(24)}`),
    /token local/,
  );
  assert.throws(
    () => buildInvitationUrl("https://safe.example", `${"x".repeat(20)} y`),
    /token local/,
  );
});

test("porta local segue a mesma sintaxe e precedência do Node 24", () => {
  assert.equal(studioPortFromEnv("VERBOO_API_KEY=segredo\n"), 8787);
  assert.equal(studioPortFromEnv("STUDIO_PORT=9123\nVERBOO_API_KEY=segredo"), 9123);
  assert.equal(studioPortFromEnv('STUDIO_PORT="9124"'), 9124);
  assert.equal(studioPortFromEnv("STUDIO_PORT=9125 # comentário"), 9125);
  assert.equal(studioPortFromEnv("STUDIO_PORT=9126\nSTUDIO_PORT=9127"), 9127);
  assert.equal(studioPortFromEnv("STUDIO_PORT=9128", "9129"), 9129);
  assert.throws(() => studioPortFromEnv("STUDIO_PORT=70000"), /STUDIO_PORT/);
  assert.throws(
    () => studioRuntimeConfigFromEnv("STUDIO_DATABASE_PATH=:memory:"),
    /banco persistente/,
  );
  assert.equal(
    studioRuntimeConfigFromEnv("STUDIO_HOST=::1\nSTUDIO_PORT=9130").host,
    "::1",
  );
  assert.equal(loopbackServerUrl("::1", 9130), "http://[::1]:9130");
  assert.throws(
    () => studioRuntimeConfigFromEnv("STUDIO_HOST=0.0.0.0"),
    /loopback/,
  );
});

test("saída do CLI entrega somente um token de convite válido", () => {
  const token = "token-local-de-uso-unico-123456";
  const output = `log do npm\n${JSON.stringify({ invite: { role: "owner" }, token }, null, 2)}\n`;
  assert.equal(ownerTokenFromCommandOutput(output), token);
  assert.throws(() => ownerTokenFromCommandOutput('{"token":"curto"}'), /convite válido/);
});

test("checksum é lido da publicação oficial pelo nome exato do asset", () => {
  const digest = "a".repeat(64);
  assert.equal(
    checksumFromReleaseBody(`cloudflared-windows-amd64.exe: ${digest}`, "cloudflared-windows-amd64.exe"),
    digest,
  );
  assert.throws(
    () => checksumFromReleaseBody(`outro.exe: ${digest}`, "cloudflared-windows-amd64.exe"),
    /checksum/,
  );
  assert.throws(
    () => checksumFromReleaseBody(`prefix-cloudflared-windows-amd64.exe: ${digest}`, "cloudflared-windows-amd64.exe"),
    /checksum/,
  );
});

test("assets oficiais são escolhidos por sistema e arquitetura", () => {
  assert.equal(cloudflaredAssetName("win32", "x64"), "cloudflared-windows-amd64.exe");
  assert.equal(cloudflaredAssetName("linux", "x64"), "cloudflared-linux-amd64");
  assert.equal(cloudflaredAssetName("linux", "arm64"), "cloudflared-linux-arm64");
  assert.throws(() => cloudflaredAssetName("darwin", "arm64"), /não suportado/);
});

test("servidor e CLI são lançados pelo Node sem shell ou npm.cmd", () => {
  assert.deepEqual(studioNodeArguments("src/index.ts"), [
    "--env-file-if-exists=.env.local",
    "--import",
    "tsx",
    "src/index.ts",
  ]);
});

test("health precisa identificar exatamente o Studio Server compatível", () => {
  const health = {
    status: "ok",
    service: "oficina-studio-server",
    apiVersion: 1,
    aiConfigured: true,
  };
  assert.equal(parseStudioHealth(health), health);
  assert.throws(
    () => parseStudioHealth({ status: "ok", aiConfigured: true }),
    /não pertence/,
  );
  assert.throws(
    () => parseStudioHealth({ ...health, apiVersion: 2 }),
    /compatível/,
  );
});

test("cloudflared recebe somente ambiente operacional sem chaves ou tokens", () => {
  const environment = tunnelEnvironment({
    Path: "C:\\Windows",
    TEMP: "C:\\Temp",
    HTTPS_PROXY: "http://proxy.local",
    HTTP_PROXY: "http://user:password@proxy.local",
    ALL_PROXY: "https://proxy.local/connect?token=segredo-sintetico",
    VERBOO_API_KEY: "não-pode-herdar",
    GH_TOKEN: "não-pode-herdar",
    AWS_SECRET_ACCESS_KEY: "não-pode-herdar",
  });
  assert.deepEqual(environment, {
    Path: "C:\\Windows",
    TEMP: "C:\\Temp",
    HTTPS_PROXY: "http://proxy.local",
  });
});

test("cloudflared omite proxies com protocolo, caminho, busca ou fragmento suspeitos", () => {
  const environment = tunnelEnvironment({
    HTTPS_PROXY: "https://proxy.local/",
    HTTP_PROXY: "http://proxy.local/segredo-sintetico",
    ALL_PROXY: "https://proxy.local/?token=segredo-sintetico",
    http_proxy: "ftp://proxy.local/",
    https_proxy: "https://proxy.local/#segredo-sintetico",
  });

  assert.deepEqual(environment, {
    HTTPS_PROXY: "https://proxy.local/",
  });
  assert.doesNotMatch(JSON.stringify(environment), /segredo-sintetico/);
});

test("Vite local recebe ambiente operacional sem nenhuma configuração de proxy", () => {
  const environment = localUiEnvironment({
    Path: "C:\\Windows",
    TEMP: "C:\\Temp",
    HTTPS_PROXY: "https://proxy.local/",
    HTTP_PROXY: "http://proxy.local/",
    ALL_PROXY: "https://proxy.local/",
    VERBOO_API_KEY: "não-pode-herdar",
  });

  assert.deepEqual(environment, {
    Path: "C:\\Windows",
    TEMP: "C:\\Temp",
  });
});

test("diagnóstico do túnel remove endereços e credenciais antes de exibir", () => {
  const message = tunnelFailureMessage(
    "falhou",
    "linha anterior\nERR url=https://private.example token=super-secret-value",
  );
  assert.match(message, /Último diagnóstico/);
  assert.doesNotMatch(message, /private\.example|super-secret-value/);
  assert.doesNotMatch(message, /\$1/);
});

test("erro de rede preserva código útil sem repetir URL pública", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect to https://private.example failed"), {
      code: "ENETUNREACH",
    }),
  });
  const message = networkErrorMessage(error);
  assert.match(message, /ENETUNREACH/);
  assert.doesNotMatch(message, /private\.example/);
});

test("fallback DoH aceita somente resposta IPv4 válida", () => {
  assert.equal(
    addressFromDohResponse({
      Status: 0,
      Answer: [
        { type: 28, data: "2606:4700::1" },
        { type: 1, data: "104.16.230.132" },
      ],
    }),
    "104.16.230.132",
  );
  assert.throws(
    () => addressFromDohResponse({ Status: 3, Answer: [] }),
    /não confirmou/,
  );
  assert.throws(
    () => addressFromDohResponse({ Status: 0, Answer: [{ type: 1, data: "not-an-ip" }] }),
    /IPv4 válido/,
  );
});

test("fallback DoH usa resolvedores independentes durante a propagação do Quick Tunnel", async () => {
  const requestedUrls = [];
  const fetchImplementation = async (url) => {
    requestedUrls.push(url);
    const payload = url.hostname === "cloudflare-dns.com"
      ? { Status: 3, Answer: [] }
      : { Status: 0, Answer: [{ type: 1, data: "104.16.231.132" }] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/dns-json" },
    });
  };

  assert.equal(
    await resolvePublicAddressWithDoh("new-tunnel.trycloudflare.com", fetchImplementation),
    "104.16.231.132",
  );
  assert.deepEqual(
    requestedUrls.map((url) => [url.origin, url.searchParams.get("name"), url.searchParams.get("type")]),
    [
      ["https://cloudflare-dns.com", "new-tunnel.trycloudflare.com", "A"],
      ["https://dns.google", "new-tunnel.trycloudflare.com", "A"],
    ],
  );
});

test("fallback DoH falha somente depois que nenhum resolvedor confirma o túnel", async () => {
  const negativeFetch = async () => new Response(JSON.stringify({ Status: 3, Answer: [] }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });
  await assert.rejects(
    resolvePublicAddressWithDoh("missing.trycloudflare.com", negativeFetch),
    /nenhum resolvedor/,
  );
});

test("lookup HTTPS atende os contratos escalar e all do Node 24", () => {
  const address = "104.16.230.132";
  const lookup = fixedAddressLookup(address);

  lookup("tunnel.trycloudflare.com", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address, family: 4 }]);
  });
  lookup("tunnel.trycloudflare.com", {}, (error, resolvedAddress, family) => {
    assert.equal(error, null);
    assert.equal(resolvedAddress, address);
    assert.equal(family, 4);
  });
  assert.throws(() => fixedAddressLookup("not-an-ip"), /endereço DoH inválido/);
});
