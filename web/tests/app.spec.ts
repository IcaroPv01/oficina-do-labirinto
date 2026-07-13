import { expect, test } from "@playwright/test";

test("abre o editor e monta uma prévia jogável", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-ready")).toBeVisible();
  await expect(page.getByTestId("game-preview").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("status")).not.toBeEmpty();
});

test("edita o projeto, reinicia e exporta um gamepack", async ({ page }) => {
  await page.goto("/");

  const projectName = page.getByTestId("project-name");
  await projectName.fill("Labirinto compartilhado");
  await expect(projectName).toHaveValue("Labirinto compartilhado");

  await page.getByTestId("seed-input").fill("amizade-2026");
  await page.getByTestId("restart-game").click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-project").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gamepack$/);
});

test("move, atira, pausa e retoma pelo preview", async ({ page }) => {
  await page.goto("/");

  const preview = page.getByTestId("game-preview");
  const host = preview.locator(".game-preview__canvas-host");
  const canvas = preview.locator("canvas");
  await canvas.click();

  const initialX = Number(await host.getAttribute("data-game-player-x"));
  await page.keyboard.down("d");
  await page.waitForTimeout(220);
  await page.keyboard.up("d");
  const movedX = Number(await host.getAttribute("data-game-player-x"));
  expect(movedX).toBeGreaterThan(initialX);

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(80);
  await page.keyboard.up("ArrowRight");
  expect(Number(await host.getAttribute("data-game-projectiles"))).toBeGreaterThan(0);

  await page.getByTestId("pause-game").click();
  await expect(host).toHaveAttribute("data-game-status", "paused");
  await page.getByTestId("pause-game").click();
  await expect(host).toHaveAttribute("data-game-status", "playing");
});
