import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createStudioServer } from "../src/server.js";

const pagesOrigin = "https://icaropv01.github.io";

test("cross-site Studio sessions use partitioned secure cookies without exposing credentials", async () => {
  const secret = "server-only-verboo-key";
  const config = loadConfig({
    STUDIO_HOST: "127.0.0.1",
    STUDIO_PORT: "0",
    STUDIO_DATABASE_PATH: ":memory:",
    STUDIO_CORS_ORIGINS: pagesOrigin,
    STUDIO_COOKIE_SECURE: "true",
    STUDIO_COOKIE_SAME_SITE: "none",
    STUDIO_DEV_AUTH_ENABLED: "true",
    VERBOO_API_KEY: secret,
  });
  const studio = createStudioServer(config);
  const address = await studio.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/health`, { headers: { origin: pagesOrigin } });
    const health = (await healthResponse.json()) as Record<string, unknown>;
    assert.equal(health.service, "oficina-studio-server");
    assert.equal(health.apiVersion, 1);
    assert.equal(health.aiConfigured, true);
    assert.equal(JSON.stringify(health).includes(secret), false);
    assert.equal("apiKey" in health, false);

    const loginResponse = await fetch(`${baseUrl}/auth/dev`, {
      method: "POST",
      headers: { origin: pagesOrigin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Icaro" }),
    });
    assert.equal(loginResponse.status, 200);
    const loginBody = (await loginResponse.json()) as { csrfToken: string };
    const setCookie = loginResponse.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Host-oficina_studio=/);
    assert.match(setCookie, /; Path=\//i);
    assert.match(setCookie, /; HttpOnly/i);
    assert.match(setCookie, /; Secure/i);
    assert.match(setCookie, /; SameSite=None/i);
    assert.match(setCookie, /; Partitioned/i);
    assert.doesNotMatch(JSON.stringify(loginBody), /sessionToken|api[_-]?key|vbk_|server-only-verboo-key/i);

    const cookie = setCookie.split(";", 1)[0]!;
    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { origin: pagesOrigin, cookie, "x-studio-csrf": loginBody.csrfToken },
    });
    assert.equal(logoutResponse.status, 204);
    const clearedCookie = logoutResponse.headers.get("set-cookie") ?? "";
    assert.match(clearedCookie, /^__Host-oficina_studio=;/);
    assert.match(clearedCookie, /; Max-Age=0/i);
    assert.match(clearedCookie, /; HttpOnly/i);
    assert.match(clearedCookie, /; Secure/i);
    assert.match(clearedCookie, /; SameSite=None/i);
    assert.match(clearedCookie, /; Partitioned/i);
    assert.equal(await logoutResponse.text(), "");
  } finally {
    await studio.close();
  }
});
