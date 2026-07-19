import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  installStudioBackendMock,
  studioInvitationUrl,
  studioProjectFileEntry,
  studioProjectFileSource,
} from "./studio-backend.fixture";

test("joga por toque sem rolagem horizontal em retrato e paisagem", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByTestId("app-ready")).toBeVisible();

  const preview = page.getByTestId("game-preview");
  const host = preview.locator(".game-preview__canvas-host");
  const controls = page.getByTestId("touch-controls");
  await expect(controls).toBeVisible();

  const touchButtons = controls.locator("button");
  await expect(touchButtons).toHaveCount(11);
  await expectTouchTargetsFit(page, touchButtons);
  await expectNoHorizontalOverflow(page);

  const initialRoom = await host.getAttribute("data-game-room");
  await hold(page.getByTestId("touch-move-east"), page, 120);
  await expect
    .poll(() => host.getAttribute("data-game-room"))
    .not.toBe(initialRoom ?? "room-0-0");

  const initialX = Number(await host.getAttribute("data-game-player-x"));
  const move = page.getByTestId("touch-move-east");
  const aim = page.getByTestId("touch-aim-east");
  await press(move, 1);
  await press(aim, 2);
  await page.waitForTimeout(240);
  await release(aim, 2);
  await release(move, 1);
  await expect
    .poll(async () => Number(await host.getAttribute("data-game-player-x")))
    .toBeGreaterThan(initialX);
  await expect
    .poll(async () => Number(await host.getAttribute("data-game-projectiles")))
    .toBeGreaterThan(0);

  await page.getByTestId("touch-pause").tap();
  await expect(host).toHaveAttribute("data-game-status", "paused");
  await expect(page.getByTestId("touch-pause")).toHaveText("Continuar");
  await expect(page.getByTestId("touch-pause")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("touch-pause").tap();
  await expect(host).toHaveAttribute("data-game-status", "playing");
  await expect(page.getByTestId("touch-pause")).toHaveText("Pausar");

  await page.getByTestId("touch-restart").tap();
  const restartedRoom = await host.getAttribute("data-game-room");
  await page.getByTestId("touch-move-east").dispatchEvent("click", { detail: 0 });
  await expect
    .poll(() => host.getAttribute("data-game-room"))
    .not.toBe(restartedRoom ?? "room-0-0");

  await page.setViewportSize({ width: 320, height: 700 });
  await expectTouchTargetsFit(page, touchButtons);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(controls).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("joga e testa a revisão candidata no celular em retrato e paisagem", async ({
  page,
}) => {
  await installStudioBackendMock(page);
  await page.goto(studioInvitationUrl());
  await page.getByLabel("Nome exibido no Estúdio").fill("Testador móvel");
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  const shell = page.locator("[data-studio-shell='ready']");
  await expect(shell).toHaveAttribute("data-mobile-view", "sandbox");
  await expect(shell.getByText("CANDIDATA", { exact: true })).toBeVisible();

  const previewHost = shell.locator("[data-studio-preview-host='game']");
  const canvasHost = previewHost.locator(".game-preview__canvas-host");
  await expect(previewHost.locator("canvas")).toBeVisible();
  const controls = previewHost.getByTestId("touch-controls");
  const touchButtons = controls.locator("button");
  await expect(controls).toBeVisible();
  await expect(touchButtons).toHaveCount(11);
  await expectTouchTargetsFit(page, touchButtons);
  await expectNoHorizontalOverflow(page);

  const firstRoom = await canvasHost.getAttribute("data-game-room");
  await hold(previewHost.getByTestId("touch-move-east"), page, 140);
  await expect
    .poll(() => canvasHost.getAttribute("data-game-room"))
    .not.toBe(firstRoom ?? "room-0-0");

  const initialX = Number(await canvasHost.getAttribute("data-game-player-x"));
  await press(previewHost.getByTestId("touch-move-east"), 11);
  await press(previewHost.getByTestId("touch-aim-east"), 12);
  await page.waitForTimeout(220);
  await release(previewHost.getByTestId("touch-aim-east"), 12);
  await release(previewHost.getByTestId("touch-move-east"), 11);
  await expect
    .poll(async () => Number(await canvasHost.getAttribute("data-game-player-x")))
    .toBeGreaterThan(initialX);
  await expect
    .poll(async () => Number(await canvasHost.getAttribute("data-game-projectiles")))
    .toBeGreaterThan(0);

  await page.setViewportSize({ width: 320, height: 700 });
  await expectTouchTargetsFit(page, touchButtons);
  await expectTargetGroupsDoNotOverlap(
    touchButtons,
    shell.locator(".studio-mobile-nav__button"),
  );
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(controls).toBeVisible();
  await expectTouchTargetsFit(page, touchButtons);
  await expectTargetGroupsDoNotOverlap(
    touchButtons,
    shell.locator(".studio-mobile-nav__button"),
  );
  await expectNoHorizontalOverflow(page);

  await shell.getByTestId("studio-run-sandbox-test").click();
  await expect(shell.getByRole("button", { name: "Aprovar para o jogo" }))
    .toBeEnabled();
});

test("explora e lê arquivo real no Estúdio em 320x700", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installStudioBackendMock(page);
  await page.goto(studioInvitationUrl());
  await page.getByLabel("Nome exibido no Estúdio").fill("Leitor móvel");
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  const shell = page.locator("[data-studio-shell='ready']");
  await shell
    .getByRole("button", { name: /Projeto/ })
    .click();
  await expect(shell).toHaveAttribute("data-mobile-view", "project");
  await expect(
    shell.getByRole("heading", { name: "Arquivos do projeto" }),
  ).toBeVisible();
  await shell.getByLabel("Buscar arquivos do projeto").fill("main.ts");
  const fileButton = shell.locator(
    `[data-project-file-path="${studioProjectFileEntry.path}"]`,
  );
  await expect(fileButton).toBeVisible();
  await fileButton.click();

  await expect(shell).toHaveAttribute("data-project-files-pane", "viewer");
  await expect(shell.getByRole("heading", { name: "main.ts" })).toBeVisible();
  await expect(shell.getByText(studioProjectFileEntry.path, { exact: true }))
    .toBeVisible();
  await expect(shell.getByText(studioProjectFileEntry.sha256, { exact: true }))
    .toBeVisible();
  await expect(
    shell.getByText(studioProjectFileSource.split("\n")[0]!, { exact: true }),
  ).toBeVisible();
  await expect(shell.getByText(/Somente leitura/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await shell.getByRole("button", { name: "Voltar aos arquivos" }).click();
  await expect(shell).toHaveAttribute("data-project-files-pane", "tree");
  await expect(
    shell.locator(`[data-project-file-path="${studioProjectFileEntry.path}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoHorizontalOverflow(page);
});

for (const viewport of [
  { label: "320x700 retrato", width: 320, height: 700 },
  { label: "844x390 paisagem", width: 844, height: 390 },
] as const) {
  test(`cria proposta com IA e abre o sandbox em ${viewport.label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installStudioBackendMock(page);
    await page.goto(studioInvitationUrl());
    await page.getByLabel("Nome exibido no Estúdio").fill("Parceiro móvel");
    await page.getByRole("button", { name: "Aceitar convite" }).click();

    const shell = page.locator("[data-studio-shell='ready']");
    const mobileNavigation = shell.locator(".studio-mobile-nav__button");
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute("data-layout", "mobile");

    for (const [label, view] of [
      ["Projeto", "project"],
      ["Sandbox", "sandbox"],
      ["Conversas", "collaboration"],
      ["Revisão", "review"],
    ] as const) {
      await page.getByRole("button", { name: label }).click();
      await expect(shell).toHaveAttribute("data-mobile-view", view);
    }

    await page.getByRole("button", { name: "Conversas" }).click();
    await page.getByRole("tab", { name: "Assistente IA" }).click();
    const assistant = page.getByRole("tabpanel", { name: "Assistente IA" });
    await assistant.getByRole("button", { name: "Propor mudança" }).tap();
    await assistant.getByPlaceholder(/proponha/i).fill("Deixe o herói mais ágil.");
    await assistant.getByRole("button", { name: "Preparar proposta" }).tap();
    await expect(assistant.getByText("NÃO APLICADA", { exact: true })).toBeVisible();
    const proposalActions = assistant.locator(
      ".studio-assistant-proposal__actions button",
    );
    await expectTouchTargetsFit(page, proposalActions);
    await expectTargetGroupsDoNotOverlap(
      proposalActions,
      mobileNavigation,
    );
    await expectNoHorizontalOverflow(page);
    await assistant.getByRole("button", { name: "Adicionar às propostas" }).tap();

    await page.getByRole("button", { name: "Sandbox" }).click();
    await expect(shell.getByText("CANDIDATA", { exact: true })).toBeVisible();
    const previewHost = shell.locator("[data-studio-preview-host='game']");
    const canvasHost = previewHost.locator(".game-preview__canvas-host");
    await expect(previewHost.locator("canvas")).toBeVisible();
    const touchButtons = previewHost.getByTestId("touch-controls").locator("button");
    await expect(touchButtons).toHaveCount(11);
    await expectTouchTargetsFit(page, touchButtons);
    await expectTargetGroupsDoNotOverlap(touchButtons, mobileNavigation);
    await expectNoHorizontalOverflow(page);

    const initialRoom = await canvasHost.getAttribute("data-game-room");
    await hold(previewHost.getByTestId("touch-move-east"), page, 140);
    await expect
      .poll(() => canvasHost.getAttribute("data-game-room"))
      .not.toBe(initialRoom ?? "room-0-0");

    const runTest = shell.getByTestId("studio-run-sandbox-test");
    await expect(runTest).toBeEnabled();
  });
}

async function hold(
  button: Locator,
  page: Page,
  milliseconds: number,
): Promise<void> {
  await press(button, 1);
  await page.waitForTimeout(milliseconds);
  await release(button, 1);
}

async function press(button: Locator, pointerId: number): Promise<void> {
  await button.dispatchEvent("pointerdown", {
    pointerId,
    pointerType: "touch",
    isPrimary: pointerId === 1,
    button: 0,
    buttons: 1,
  });
}

async function release(button: Locator, pointerId: number): Promise<void> {
  await button.dispatchEvent("pointerup", {
    pointerId,
    pointerType: "touch",
    isPrimary: pointerId === 1,
    button: 0,
    buttons: 0,
  });
}

async function expectTouchTargetsFit(page: Page, buttons: Locator): Promise<void> {
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const targets: Array<{
    readonly name: string;
    readonly box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  }> = [];
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    const name =
      (await button.getAttribute("data-testid")) ??
      (await button.getAttribute("aria-label")) ??
      "controle sem nome";
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
    targets.push({ name, box });
  }
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      const firstTarget = targets[left]!;
      const secondTarget = targets[right]!;
      const a = firstTarget.box;
      const b = secondTarget.box;
      const intersectionWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const intersectionHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(
        intersectionWidth > 0 && intersectionHeight > 0,
        `${firstTarget.name} (${formatBox(a)}) não pode sobrepor ${secondTarget.name} (${formatBox(b)})`,
      ).toBe(false);
    }
  }
}

function formatBox(box: { x: number; y: number; width: number; height: number }): string {
  return `x=${box.x.toFixed(1)}, y=${box.y.toFixed(1)}, largura=${box.width.toFixed(1)}, altura=${box.height.toFixed(1)}`;
}

async function expectTargetGroupsDoNotOverlap(
  firstGroup: Locator,
  secondGroup: Locator,
): Promise<void> {
  const firstTargets = await visibleTargetBoxes(firstGroup);
  const secondTargets = await visibleTargetBoxes(secondGroup);
  for (const first of firstTargets) {
    for (const second of secondTargets) {
      const intersectionWidth =
        Math.min(first.box.x + first.box.width, second.box.x + second.box.width) -
        Math.max(first.box.x, second.box.x);
      const intersectionHeight =
        Math.min(first.box.y + first.box.height, second.box.y + second.box.height) -
        Math.max(first.box.y, second.box.y);
      expect(
        intersectionWidth > 0 && intersectionHeight > 0,
        `${first.name} (${formatBox(first.box)}) não pode sobrepor ${second.name} (${formatBox(second.box)})`,
      ).toBe(false);
    }
  }
}

async function visibleTargetBoxes(targets: Locator): Promise<Array<{
  readonly name: string;
  readonly box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
}>> {
  const result: Array<{
    readonly name: string;
    readonly box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  }> = [];
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    if (!box) continue;
    result.push({
      name:
        (await target.getAttribute("data-testid")) ??
        (await target.getAttribute("aria-label")) ??
        (await target.textContent()) ??
        "controle sem nome",
      box,
    });
  }
  return result;
}

async function expectNoHorizontalOverflow(
  page: Page,
): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}
