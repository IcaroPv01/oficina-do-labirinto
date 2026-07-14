import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  installStudioBackendMock,
  studioInvitationUrl,
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

test("usa todo o Estúdio no layout mobile sem perder navegação", async ({
  page,
}) => {
  await installStudioBackendMock(page);
  await page.goto(studioInvitationUrl());
  await page.getByLabel("Nome exibido no Estúdio").fill("Parceiro móvel");
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  const shell = page.locator("[data-studio-shell='ready']");
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute("data-layout", "mobile");
  await expect(page.getByRole("button", { name: "Encerrar sessão" })).toBeVisible();

  for (const [label, view] of [
    ["Projeto", "project"],
    ["Sandbox", "sandbox"],
    ["Conversas", "collaboration"],
    ["Revisão", "review"],
  ] as const) {
    await page.getByRole("button", { name: label }).click();
    await expect(shell).toHaveAttribute("data-mobile-view", view);
  }

  await page.getByRole("button", { name: "Sandbox" }).click();
  const mobileTargets = shell.locator(
    ".studio-touch-button, .studio-mobile-nav__button",
  );
  await expectTouchTargetsFit(page, mobileTargets);
  await expectNoHorizontalOverflow(page);
});

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

async function expectNoHorizontalOverflow(
  page: Page,
): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}
