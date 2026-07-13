import { expect, test } from "@playwright/test";
import defaultProject from "../../game-data/default-project.json" with { type: "json" };

test("abre o editor e monta uma prévia jogável", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByTestId("app-ready")).toBeVisible();
  await expect(page.getByTestId("game-preview").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("status")).not.toBeEmpty();
});

test("edita o projeto, reinicia e exporta um gamepack", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

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
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

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
  await expect(canvas).toBeFocused();

  await page.getByTestId("restart-game").click();
  await expect(host).toHaveAttribute("data-game-status", "room-cleared");
  await expect(canvas).toBeFocused();
});

test("reconfigura a dungeon e atualiza o mapa acessível", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

  const roomsPerFloor = page.locator("[data-rooms-per-floor]");
  await roomsPerFloor.fill("12");
  await roomsPerFloor.press("Tab");

  const map = page.locator("[data-dungeon-map]");
  await expect(map.locator(".dungeon-map__room")).toHaveCount(12);
  await expect(map.getByRole("group", { name: /12 salas conectadas/i })).toBeVisible();
});

test("viaja da sala inicial e registra a visita", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

  const preview = page.getByTestId("game-preview");
  const host = preview.locator(".game-preview__canvas-host");
  const canvas = preview.locator("canvas");
  await expect(host).toHaveAttribute("data-game-room", "room-0-0");
  await canvas.click();
  await page.keyboard.press("d");

  await expect(host).not.toHaveAttribute("data-game-room", "room-0-0");
  await expect(host).toHaveAttribute("data-game-visited-rooms", /room-0-0,room-/);
  await expect(page.getByTestId("status")).toContainText(/você entrou/i);
});

test("recusa skin falsa incorporada em gamepack", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

  const invalidProject = {
    ...structuredClone(defaultProject),
    player: {
      ...structuredClone(defaultProject.player),
      skinDataUrl: "data:image/png;base64,QUFBQQ==",
    },
  };
  const gamepack = {
    format: "jogo-colaborativo.gamepack",
    formatVersion: 1,
    exportedAt: "2026-07-13T12:00:00.000Z",
    project: invalidProject,
  };
  await page.getByTestId("import-project").setInputFiles({
    name: "skin-falsa.gamepack",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(gamepack)),
  });

  await expect(page.getByTestId("status")).toContainText(/não foi importado/i);
  await expect(page.getByTestId("project-name")).toHaveValue(
    defaultProject.name,
  );
});
