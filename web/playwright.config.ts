import { defineConfig, devices } from "@playwright/test";

import { resolveSiteBase } from "./scripts/resolve-site-base";

const previewPort = 4174;
const previewOrigin = `http://127.0.0.1:${previewPort}`;
const basePath = resolveSiteBase(process.env);
const baseURL = new URL(basePath, previewOrigin).toString();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
