import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GAME_PROJECT,
  cloneGameProject,
  type GameProject,
} from "../core";
import type { GamePreviewHandle } from "../game";
import { createSandboxPreviewRuntime } from "./sandbox-preview-runtime";

type PreviewFactory = (
  host: HTMLElement,
  project: GameProject,
) => GamePreviewHandle;

function fakeHost(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function previewHandle(): GamePreviewHandle {
  return {
    updateProject: vi.fn(),
    restart: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("sandbox preview runtime", () => {
  it("reuses the Phaser preview when only the candidate changes", async () => {
    const host = fakeHost();
    const handle = previewHandle();
    const factory = vi.fn(() => handle);
    const runtime = createSandboxPreviewRuntime({
      loadCreateGamePreview: async () => factory,
    });

    await runtime.show(host, DEFAULT_GAME_PROJECT);
    const fasterCandidate = cloneGameProject(DEFAULT_GAME_PROJECT);
    fasterCandidate.player.speed = 280;
    await runtime.show(host, fasterCandidate);

    expect(factory).toHaveBeenCalledOnce();
    expect(handle.updateProject).toHaveBeenCalledWith(fasterCandidate);
    expect(handle.restart).toHaveBeenCalledOnce();
    expect(host.dataset["previewState"]).toBe("ready");
  });

  it("does not mount a stale candidate after a delayed import", async () => {
    const host = fakeHost();
    const factory: PreviewFactory = vi.fn(() => previewHandle());
    let resolveLoader: ((factory: PreviewFactory) => void) | undefined;
    const runtime = createSandboxPreviewRuntime({
      loadCreateGamePreview: () =>
        new Promise<PreviewFactory>((resolve) => {
          resolveLoader = resolve;
        }),
    });

    const pending = runtime.show(host, DEFAULT_GAME_PROJECT);
    runtime.clear();
    resolveLoader?.(factory);
    await pending;

    expect(factory).not.toHaveBeenCalled();
    expect(host.dataset["previewState"]).toBeUndefined();
  });

  it("pauses work hidden behind another mobile Studio view", async () => {
    const host = fakeHost();
    const handle = previewHandle();
    const runtime = createSandboxPreviewRuntime({
      loadCreateGamePreview: async () => () => handle,
    });

    runtime.setActive(false);
    await runtime.show(host, DEFAULT_GAME_PROJECT);
    runtime.setActive(true);

    expect(handle.pause).toHaveBeenCalledOnce();
    expect(handle.resume).toHaveBeenCalledOnce();
  });

  it("reports a lazy-load failure without leaving a false ready state", async () => {
    const host = fakeHost();
    const onFailure = vi.fn();
    const runtime = createSandboxPreviewRuntime({
      loadCreateGamePreview: async () => {
        throw new Error("chunk indisponível");
      },
      onFailure,
    });

    await runtime.show(host, DEFAULT_GAME_PROJECT);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(host.dataset["previewState"]).toBeUndefined();
  });
});
