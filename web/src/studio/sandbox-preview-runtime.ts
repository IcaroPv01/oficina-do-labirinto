import type { GameProject } from "../core";
import type { GamePreviewHandle } from "../game";

type CreateGamePreview = (
  container: HTMLElement,
  project: GameProject,
) => GamePreviewHandle;

export interface SandboxPreviewRuntimeOptions {
  readonly loadCreateGamePreview?: () => Promise<CreateGamePreview>;
  readonly onFailure?: (error: unknown) => void;
}

export interface SandboxPreviewRuntime {
  /** Mounts once, then updates the existing Phaser instance for later candidates. */
  show(host: HTMLElement, project: GameProject): Promise<void>;
  setActive(active: boolean): void;
  clear(): void;
  destroy(): void;
}

/**
 * Owns the lazy Phaser lifecycle without coupling it to Studio rendering.
 * Request generations prevent a slow dynamic import from mounting a stale candidate.
 */
export function createSandboxPreviewRuntime(
  options: SandboxPreviewRuntimeOptions = {},
): SandboxPreviewRuntime {
  const loadCreateGamePreview =
    options.loadCreateGamePreview ?? defaultPreviewLoader;
  let activeHost: HTMLElement | null = null;
  let activePreview: GamePreviewHandle | null = null;
  let requestGeneration = 0;
  let destroyed = false;
  let shouldRun = true;

  const destroyActivePreview = (): void => {
    activePreview?.destroy();
    activePreview = null;
    if (activeHost) {
      delete activeHost.dataset["previewState"];
    }
    activeHost = null;
  };

  return {
    async show(host, project) {
      if (destroyed) {
        return;
      }

      const generation = ++requestGeneration;
      if (activePreview && activeHost === host) {
        activePreview.updateProject(project);
        activePreview.restart();
        if (!shouldRun) {
          activePreview.pause();
        }
        host.dataset["previewState"] = "ready";
        return;
      }

      destroyActivePreview();
      activeHost = host;
      host.dataset["previewState"] = "loading";

      try {
        const createGamePreview = await loadCreateGamePreview();
        if (destroyed || generation !== requestGeneration || activeHost !== host) {
          return;
        }
        activePreview = createGamePreview(host, project);
        if (!shouldRun) {
          activePreview.pause();
        }
        host.dataset["previewState"] = "ready";
      } catch (error) {
        if (generation !== requestGeneration || destroyed) {
          return;
        }
        delete host.dataset["previewState"];
        activeHost = null;
        options.onFailure?.(error);
      }
    },
    setActive(active) {
      shouldRun = active;
      if (active) {
        activePreview?.resume();
      } else {
        activePreview?.pause();
      }
    },
    clear() {
      requestGeneration += 1;
      destroyActivePreview();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      requestGeneration += 1;
      destroyActivePreview();
    },
  };
}

async function defaultPreviewLoader(): Promise<CreateGamePreview> {
  const gameModule = await import("../game");
  return gameModule.createGamePreview;
}
