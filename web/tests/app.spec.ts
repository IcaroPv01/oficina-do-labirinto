import { expect, test } from "@playwright/test";
import defaultProject from "../../game-data/default-project.json" with { type: "json" };
import {
  createdStudioInvitation,
  installStudioBackendMock,
  studioInvitation,
  studioInvitationUrl,
  studioProject,
} from "./studio-backend.fixture";

test("abre o editor e monta uma prévia jogável", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByTestId("app-ready")).toBeVisible();
  await expect(page.getByTestId("game-preview").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("status")).not.toBeEmpty();
  await expect(page.getByTestId("open-studio")).toHaveAttribute(
    "href",
    "?studio=1",
  );
});

test("resgata convite pelo fragmento e abre o Estúdio autenticado", async ({
  page,
}) => {
  await installStudioBackendMock(page);
  await page.goto(studioInvitationUrl());
  await expect(page.getByRole("heading", { name: "Entrar pelo convite" })).toBeVisible();
  await page.getByLabel("Nome exibido no Estúdio").fill("Parceiro móvel");
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  await expect(page.locator("[data-studio-shell='ready']")).toBeVisible();
  await expect(page.getByRole("heading", { name: studioProject.name })).toBeVisible();
  expect(page.url()).not.toContain(studioInvitation);
  await expect(page.getByLabel("Modelo da assistente IA")).toContainText(
    "DeepSeek V4 Flash",
  );

  await page.getByRole("tab", { name: "Conversa" }).click();
  const humanChat = page.getByRole("tabpanel", { name: "Conversa" });
  await humanChat.getByPlaceholder(/Escreva uma mensagem/).fill("Fechei a nova sala.");
  await humanChat.getByRole("button", { name: "Enviar" }).click();
  await expect(humanChat).toContainText("Fechei a nova sala.");

  await page.getByRole("tab", { name: "Assistente IA" }).click();
  const assistant = page.getByRole("tabpanel", { name: "Assistente IA" });
  await assistant.getByPlaceholder(/explique/i).fill("Explique um movimento simples.");
  await assistant.getByRole("button", { name: "Enviar pergunta" }).click();
  await expect(assistant).toContainText("nada foi aplicado ao jogo");

  await assistant.getByRole("button", { name: "Propor mudança" }).click();
  await assistant.getByPlaceholder(/proponha/i).fill("Deixe o herói um pouco mais ágil.");
  await assistant.getByRole("button", { name: "Preparar proposta" }).click();
  await expect(assistant.getByText("NÃO APLICADA", { exact: true })).toBeVisible();
  await expect(assistant).toContainText("Pode alterar o ritmo das salas");
  await assistant.getByRole("button", { name: "Adicionar às propostas" }).click();
  await expect(assistant.getByText("NÃO APLICADA", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-studio-shell='ready']")).toContainText("Herói mais ágil");
  await expect(page.getByRole("button", { name: "Aprovar para o jogo" })).toBeDisabled();

  await page.getByRole("button", { name: "Encerrar sessão" }).click();
  await expect(page.getByTestId("app-ready")).toBeVisible();
});

test("owner local cria convite Pages usando somente o túnel público anunciado", async ({
  page,
}) => {
  const localStudioServer = "http://127.0.0.1:8787";
  const publicStudioServer = "https://public-studio.example/";
  const publicPagesUrl =
    "https://icaropv01.github.io/oficina-do-labirinto/";
  const studioRequests: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      requestUrl.origin === new URL(localStudioServer).origin ||
      requestUrl.origin === new URL(publicStudioServer).origin
    ) {
      studioRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    const sharedWindow = window as typeof window & {
      __studioSharedUrl?: string;
    };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        sharedWindow.__studioSharedUrl = String(data.url ?? "");
      },
    });
  });
  await installStudioBackendMock(page, {
    initiallyAuthenticated: true,
    serverOrigin: localStudioServer,
  });
  const bootstrap = new URLSearchParams({
    studio: "1",
    studioServer: localStudioServer,
    publicStudioServer,
    publicPagesUrl,
  });

  await page.goto(`./?${bootstrap.toString()}`);
  await expect(page.locator("[data-studio-shell='ready']")).toBeVisible();
  await page.getByRole("button", { name: "Convidar amigo" }).click();
  await expect(page.getByText(/Link pronto/)).toBeVisible();
  await page.getByRole("button", { name: "Compartilhar" }).click();

  const sharedUrl = await page.evaluate(() =>
    (window as typeof window & { __studioSharedUrl?: string })
      .__studioSharedUrl,
  );
  expect(sharedUrl).toBeTruthy();
  const invitation = new URL(sharedUrl!);
  expect(invitation.origin).toBe("https://icaropv01.github.io");
  expect(invitation.pathname).toBe("/oficina-do-labirinto/");
  expect(invitation.searchParams.get("studio")).toBe("1");
  expect(invitation.searchParams.get("studioServer")).toBe(
    publicStudioServer,
  );
  expect(invitation.searchParams.get("publicStudioServer")).toBeNull();
  expect(invitation.searchParams.get("publicPagesUrl")).toBeNull();
  expect(invitation.searchParams.get("invite")).toBeNull();
  expect(invitation.hash).toBe(`#invite=${createdStudioInvitation}`);
  expect(sharedUrl!.slice(0, sharedUrl!.indexOf("#"))).not.toContain(
    createdStudioInvitation,
  );
  expect(studioRequests.length).toBeGreaterThan(0);
  expect(
    studioRequests.every(
      (requestUrl) => new URL(requestUrl).origin === new URL(localStudioServer).origin,
    ),
  ).toBe(true);
});

test("joga a candidata, registra o teste exato e só então aprova", async ({
  page,
}) => {
  await installStudioBackendMock(page);
  await page.goto(studioInvitationUrl());
  await page.getByLabel("Nome exibido no Estúdio").fill("Dono testador");
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  const shell = page.locator("[data-studio-shell='ready']");
  await expect(shell.getByText("CANDIDATA", { exact: true })).toBeVisible();
  const previewHost = shell.locator("[data-studio-preview-host='game']");
  const canvasHost = previewHost.locator(".game-preview__canvas-host");
  const canvas = previewHost.locator("canvas");
  await expect(canvas).toBeVisible();

  await canvas.click();
  const firstRoom = await canvasHost.getAttribute("data-game-room");
  await page.keyboard.press("d");
  await expect
    .poll(() => canvasHost.getAttribute("data-game-room"))
    .not.toBe(firstRoom ?? "room-0-0");

  const approve = shell.getByRole("button", { name: "Aprovar para o jogo" });
  await expect(approve).toBeDisabled();
  await shell.getByTestId("studio-run-sandbox-test").click();
  await expect(approve).toBeEnabled();
  await expect(shell).toContainText("A pessoa confirmou a prévia jogável");

  await approve.click();
  await expect(shell.getByText("Aprovada", { exact: true })).toBeVisible();
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

  await page.getByTestId("project-name").click();
  const elapsedWhileEditing = await host.getAttribute("data-game-elapsed-ms");
  await page.waitForTimeout(250);
  await expect(host).toHaveAttribute("data-game-elapsed-ms", elapsedWhileEditing ?? "0");

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
