import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const baseEnv: NodeJS.ProcessEnv = {
  STUDIO_CORS_ORIGINS: "https://icaropv01.github.io",
};

test("configuration is secure and loopback-only by default", () => {
  const config = loadConfig(baseEnv, "C:/studio-test");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.cookieSecure, true);
  assert.equal(config.cookieSameSite, "none");
  assert.equal(config.devAuthEnabled, false);
  assert.deepEqual([...config.corsOrigins], ["https://icaropv01.github.io"]);
  assert.equal(config.verbooBaseUrl, "https://code.verboo.ai/router/v1");
});

test("configuration rejects wildcard CORS and unsafe remote development", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, STUDIO_CORS_ORIGINS: "https://*.example.com" }),
    /não aceita curingas/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        STUDIO_HOST: "0.0.0.0",
        STUDIO_DEV_AUTH_ENABLED: "true",
      }),
    /STUDIO_DEV_AUTH_ENABLED/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        STUDIO_HOST: "0.0.0.0",
        STUDIO_COOKIE_SECURE: "false",
        STUDIO_COOKIE_SAME_SITE: "lax",
      }),
    /Cookie sem Secure/,
  );
});

test("configuration accepts insecure cookies only for explicit local development", () => {
  const config = loadConfig({
    ...baseEnv,
    STUDIO_CORS_ORIGINS: "http://localhost:5173",
    STUDIO_COOKIE_SECURE: "false",
    STUDIO_COOKIE_SAME_SITE: "lax",
    STUDIO_DEV_AUTH_ENABLED: "true",
  });
  assert.equal(config.cookieName, "oficina_studio_dev");
  assert.equal(config.devAuthEnabled, true);
});
