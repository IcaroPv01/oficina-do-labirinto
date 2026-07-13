import "./editor/editor.css";

import {
  DEFAULT_GAME_PROJECT,
  parseGameProject,
  type GameProject,
} from "./core";
import {
  createGamePreview,
  type GamePreviewHandle,
  type GamePreviewSnapshot,
  type GamePreviewStatus,
} from "./game";
import { downloadGamepack, parseGamepack } from "./editor/gamepack";
import { EditorHistory, type HistorySnapshot } from "./editor/history";
import { readValidatedPng } from "./editor/image-upload";
import {
  patchEditorProject,
  readEditorProject,
  type EditorProjectPatch,
} from "./editor/project-adapter";
import {
  createAutosaveController,
  loadAutosave,
  saveAutosave,
} from "./storage";

type StatusTone = "ready" | "working" | "error";

interface EditorElements {
  readonly projectName: HTMLInputElement;
  readonly seed: HTMLInputElement;
  readonly playerPrimary: HTMLInputElement;
  readonly playerSecondary: HTMLInputElement;
  readonly playerHealth: HTMLInputElement;
  readonly playerSpeed: HTMLInputElement;
  readonly enemyName: HTMLInputElement;
  readonly enemyColor: HTMLInputElement;
  readonly enemyHealth: HTMLInputElement;
  readonly enemySpeed: HTMLInputElement;
  readonly enemyDamage: HTMLInputElement;
  readonly skinUpload: HTMLInputElement;
  readonly skinPreview: HTMLElement;
  readonly skinMetadata: HTMLElement;
  readonly undo: HTMLButtonElement;
  readonly redo: HTMLButtonElement;
  readonly play: HTMLButtonElement;
  readonly pause: HTMLButtonElement;
  readonly restart: HTMLButtonElement;
  readonly exportProject: HTMLButtonElement;
  readonly importProject: HTMLInputElement;
  readonly preview: HTMLElement;
  readonly metrics: HTMLElement;
  readonly previewStatus: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly statusText: HTMLElement;
  readonly saveState: HTMLElement;
}

export async function mountApplication(root: HTMLElement): Promise<void> {
  root.innerHTML = applicationTemplate();
  const elements = collectElements(root);

  const setStatus = (message: string, tone: StatusTone = "ready"): void => {
    elements.statusBar.dataset["tone"] = tone;
    elements.statusText.textContent = message;
  };

  let project = structuredClone(DEFAULT_GAME_PROJECT) as GameProject;
  let restoredAt: Date | null = null;

  try {
    const stored = await loadAutosave<unknown>();
    if (stored) {
      project = parseGameProject(stored.project);
      restoredAt = stored.updatedAt;
    }
  } catch (cause: unknown) {
    setStatus(
      `O autosave não pôde ser restaurado. ${errorMessage(cause)}`,
      "error",
    );
  }

  const history = new EditorHistory<GameProject>(project, 75);
  let gamePreview: GamePreviewHandle | null = null;
  let previewPaused = false;

  const autosave = createAutosaveController<GameProject>(saveAutosave, {
    delayMilliseconds: 450,
    onSaved(savedAt) {
      elements.saveState.textContent = `Salvo às ${formatTime(savedAt)}`;
    },
    onError(error) {
      elements.saveState.textContent = "Autosave indisponível";
      setStatus(
        `Não foi possível salvar neste navegador. Exporte um .gamepack para não perder mudanças. ${error.message}`,
        "error",
      );
    },
  });

  const renderProject = (snapshot: HistorySnapshot<GameProject>): void => {
    project = snapshot.present;
    const fields = readEditorProject(project);

    elements.projectName.value = fields.name;
    elements.seed.value = fields.seed;
    elements.playerPrimary.value = fields.playerPrimaryColor;
    elements.playerSecondary.value = fields.playerSecondaryColor;
    elements.playerHealth.value = String(fields.playerHealth);
    elements.playerSpeed.value = String(fields.playerSpeed);
    elements.undo.disabled = !snapshot.canUndo;
    elements.redo.disabled = !snapshot.canRedo;

    const enemyInputs = [
      elements.enemyName,
      elements.enemyColor,
      elements.enemyHealth,
      elements.enemySpeed,
      elements.enemyDamage,
    ];

    if (fields.enemy) {
      elements.enemyName.value = fields.enemy.name;
      elements.enemyColor.value = fields.enemy.color;
      elements.enemyHealth.value = String(fields.enemy.health);
      elements.enemySpeed.value = String(fields.enemy.speed);
      elements.enemyDamage.value = String(fields.enemy.damage);
      enemyInputs.forEach((input) => {
        input.disabled = false;
      });
    } else {
      elements.enemyName.value = "";
      enemyInputs.forEach((input) => {
        input.disabled = true;
      });
    }

    renderSkin(
      elements.skinPreview,
      elements.skinMetadata,
      fields.playerSkin,
      fields.playerPrimaryColor,
      fields.playerSecondaryColor,
    );
  };

  const applySnapshot = (
    snapshot: HistorySnapshot<GameProject>,
    message: string,
    restartPreview = false,
  ): void => {
    renderProject(snapshot);
    gamePreview?.updateProject(project);
    if (restartPreview) {
      gamePreview?.restart();
    }
    autosave.schedule(project);
    setStatus(message);
  };

  const commit = (
    patch: EditorProjectPatch,
    message: string,
    restartPreview = false,
  ): void => {
    try {
      const draft = patchEditorProject(project, patch);
      const nextProject = parseGameProject(draft);
      applySnapshot(history.push(nextProject), message, restartPreview);
    } catch (cause: unknown) {
      renderProject(history.snapshot);
      setStatus(`Mudança rejeitada. ${errorMessage(cause)}`, "error");
    }
  };

  const commitNumericInput = (
    input: HTMLInputElement,
    createPatch: (value: number) => EditorProjectPatch,
    message: string,
  ): void => {
    try {
      commit(createPatch(numberFromInput(input)), message, true);
    } catch (cause: unknown) {
      renderProject(history.snapshot);
      setStatus(`Valor inválido. ${errorMessage(cause)}`, "error");
    }
  };

  renderProject(history.snapshot);

  try {
    gamePreview = createGamePreview(elements.preview, project, {
      autoFocus: false,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      onStatusChange(status: GamePreviewStatus) {
        renderPreviewStatus(elements, status);
        previewPaused = status.phase === "paused";
        elements.pause.textContent = previewPaused ? "Continuar" : "Pausar";
      },
      onSnapshot(snapshot: GamePreviewSnapshot) {
        renderPreviewMetrics(elements.metrics, snapshot);
      },
    });
  } catch (cause: unknown) {
    elements.preview.replaceChildren();
    const message = document.createElement("p");
    message.className = "preview-empty";
    message.textContent = `A prévia não pôde iniciar. ${errorMessage(cause)}`;
    elements.preview.append(message);
    setStatus(message.textContent, "error");
  }

  if (restoredAt) {
    elements.saveState.textContent = `Restaurado de ${formatTime(restoredAt)}`;
    setStatus("Projeto restaurado do autosave local.");
  } else if (elements.statusBar.dataset["tone"] !== "error") {
    setStatus("Projeto pronto. As mudanças são salvas somente neste navegador.");
  }

  elements.projectName.addEventListener("change", () => {
    commit({ name: elements.projectName.value.trim() }, "Nome do projeto atualizado.");
  });
  elements.seed.addEventListener("change", () => {
    commit(
      { seed: elements.seed.value.trim() },
      "Seed atualizada e partida reiniciada.",
      true,
    );
  });
  elements.playerPrimary.addEventListener("change", () => {
    commit(
      { playerPrimaryColor: elements.playerPrimary.value },
      "Cor principal do jogador atualizada.",
    );
  });
  elements.playerSecondary.addEventListener("change", () => {
    commit(
      { playerSecondaryColor: elements.playerSecondary.value },
      "Cor de detalhe do jogador atualizada.",
    );
  });
  elements.playerHealth.addEventListener("change", () => {
    commitNumericInput(
      elements.playerHealth,
      (value) => ({ playerHealth: value }),
      "Vida do jogador atualizada.",
    );
  });
  elements.playerSpeed.addEventListener("change", () => {
    commitNumericInput(
      elements.playerSpeed,
      (value) => ({ playerSpeed: value }),
      "Velocidade do jogador atualizada.",
    );
  });
  elements.enemyName.addEventListener("change", () => {
    commit(
      { enemy: { name: elements.enemyName.value.trim() } },
      "Nome do inimigo atualizado.",
    );
  });
  elements.enemyColor.addEventListener("change", () => {
    commit(
      { enemy: { color: elements.enemyColor.value } },
      "Cor do inimigo atualizada.",
    );
  });
  elements.enemyHealth.addEventListener("change", () => {
    commitNumericInput(
      elements.enemyHealth,
      (value) => ({ enemy: { health: value } }),
      "Vida do inimigo atualizada.",
    );
  });
  elements.enemySpeed.addEventListener("change", () => {
    commitNumericInput(
      elements.enemySpeed,
      (value) => ({ enemy: { speed: value } }),
      "Velocidade do inimigo atualizada.",
    );
  });
  elements.enemyDamage.addEventListener("change", () => {
    commitNumericInput(
      elements.enemyDamage,
      (value) => ({ enemy: { damage: value } }),
      "Dano do inimigo atualizado.",
    );
  });

  elements.skinUpload.addEventListener("change", async () => {
    const file = elements.skinUpload.files?.[0];
    if (!file) {
      return;
    }

    elements.skinUpload.disabled = true;
    setStatus("Validando a skin PNG…", "working");
    try {
      const skin = await readValidatedPng(file);
      commit(
        { playerSkin: skin },
        `Skin ${skin.filename} importada (${skin.width}×${skin.height}px).`,
      );
    } catch (cause: unknown) {
      setStatus(`A skin não foi importada. ${errorMessage(cause)}`, "error");
    } finally {
      elements.skinUpload.value = "";
      elements.skinUpload.disabled = false;
    }
  });

  elements.undo.addEventListener("click", () => {
    applySnapshot(history.undo(), "Última mudança desfeita.", true);
  });
  elements.redo.addEventListener("click", () => {
    applySnapshot(history.redo(), "Mudança refeita.", true);
  });
  elements.play.addEventListener("click", () => {
    gamePreview?.resume();
    previewPaused = false;
    setStatus("Prévia em execução. Use WASD para mover e as setas para atirar.");
  });
  elements.pause.addEventListener("click", () => {
    if (previewPaused) {
      gamePreview?.resume();
      setStatus("Prévia retomada.");
    } else {
      gamePreview?.pause();
      setStatus("Prévia pausada.");
    }
  });
  elements.restart.addEventListener("click", () => {
    gamePreview?.restart();
    setStatus("Prévia reiniciada com a seed atual.");
  });
  elements.exportProject.addEventListener("click", async () => {
    await autosave.flush();
    downloadGamepack(project, readEditorProject(project).name);
    setStatus("Gamepack exportado. Guarde o arquivo ou adicione-o ao Git.");
  });
  elements.importProject.addEventListener("change", async () => {
    const file = elements.importProject.files?.[0];
    if (!file) {
      return;
    }

    setStatus("Validando o gamepack…", "working");
    try {
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("O gamepack excede o limite de 8 MB deste editor.");
      }
      const importedProject = parseGamepack(await file.text(), parseGameProject);
      applySnapshot(
        history.reset(importedProject),
        `Projeto “${readEditorProject(importedProject).name}” importado.`,
        true,
      );
    } catch (cause: unknown) {
      setStatus(`O projeto não foi importado. ${errorMessage(cause)}`, "error");
    } finally {
      elements.importProject.value = "";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void autosave.flush();
    }
  });
  window.addEventListener("beforeunload", () => {
    void autosave.dispose();
    gamePreview?.destroy();
  });

  required(root, "[data-app-shell]", "aplicação").setAttribute(
    "data-testid",
    "app-ready",
  );
}

function applicationTemplate(): string {
  return `
    <div class="editor-shell" data-app-shell>
      <header class="editor-topbar">
        <div class="editor-brand">
          <div class="editor-brand__mark" aria-hidden="true">◆</div>
          <div>
            <h1>Oficina do Labirinto</h1>
            <p>Jogo e editor local, sem servidor</p>
          </div>
        </div>
        <div class="editor-topbar__actions">
          <button class="button--quiet" type="button" data-testid="undo" title="Desfazer mudança" disabled>↶ Desfazer</button>
          <button class="button--quiet" type="button" data-testid="redo" title="Refazer mudança" disabled>↷ Refazer</button>
          <button type="button" data-testid="export-project">Exportar .gamepack</button>
          <label class="button-like" for="gamepack-input">Importar projeto</label>
          <input class="sr-only" id="gamepack-input" data-testid="import-project" type="file" accept=".gamepack,application/json">
        </div>
      </header>

      <main class="editor-layout">
        <aside class="editor-panel" aria-labelledby="project-panel-title">
          <div class="editor-panel__heading">
            <h2 id="project-panel-title">Projeto</h2>
          </div>
          <label class="editor-field">
            <span>Nome do jogo</span>
            <input data-testid="project-name" type="text" maxlength="80" autocomplete="off">
          </label>
          <label class="editor-field">
            <span>Seed da partida</span>
            <input data-testid="seed-input" type="text" maxlength="80" spellcheck="false" autocomplete="off">
            <small>A mesma seed reproduz a mesma sala.</small>
          </label>
          <hr class="editor-divider">
          <h3>Histórico</h3>
          <p class="field-help">Até 75 mudanças podem ser desfeitas nesta sessão. Importar um projeto inicia um novo histórico.</p>
          <hr class="editor-divider">
          <h3>Colaboração</h3>
          <p class="field-help">Exporte o gamepack, adicione-o à sua branch e envie um pull request. Nada é enviado automaticamente.</p>
        </aside>

        <section class="preview-workspace" aria-labelledby="preview-title">
          <div class="preview-heading">
            <div>
              <h2 id="preview-title">Prévia jogável</h2>
              <span class="field-help" data-preview-status>Preparando motor…</span>
            </div>
            <div class="preview-toolbar" aria-label="Controles da prévia">
              <button class="button--primary" type="button" data-testid="restart-game">Reiniciar</button>
              <button type="button" data-testid="pause-game">Pausar</button>
              <button type="button" data-testid="play-game">Jogar</button>
            </div>
          </div>
          <div class="game-preview" data-testid="game-preview" aria-label="Área do jogo"></div>
          <div class="preview-metrics" aria-label="Estado da partida" aria-live="polite"></div>
        </section>

        <aside class="editor-panel editor-panel--inspector" aria-labelledby="inspector-title">
          <div class="editor-panel__heading">
            <h2 id="inspector-title">Inspetor</h2>
          </div>
          <section>
            <h3>Jogador</h3>
            <div class="skin-card">
              <div class="skin-preview" data-skin-preview aria-label="Prévia da skin"></div>
              <div class="skin-meta" data-skin-metadata></div>
            </div>
            <label class="upload-button button-like" for="skin-input">Escolher PNG</label>
            <input class="sr-only" id="skin-input" data-testid="skin-upload" type="file" accept="image/png,.png">
            <p class="field-help">PNG de 8×8 a 512×512px, até 2 MB. A imagem fica somente no projeto.</p>
            <div class="field-row">
              <label class="editor-field">
                <span>Cor principal</span>
                <input type="color" data-player-primary>
              </label>
              <label class="editor-field">
                <span>Detalhe</span>
                <input type="color" data-player-secondary>
              </label>
            </div>
            <div class="field-row">
              <label class="editor-field">
                <span>Vida máxima</span>
                <input type="number" data-player-health min="1" max="20" step="1">
              </label>
              <label class="editor-field">
                <span>Velocidade</span>
                <input type="number" data-player-speed min="60" max="500" step="10">
              </label>
            </div>
          </section>
          <section>
            <h3>Inimigo básico</h3>
            <label class="editor-field">
              <span>Nome</span>
              <input type="text" data-enemy-name maxlength="40">
            </label>
            <label class="editor-field">
              <span>Cor</span>
              <input type="color" data-enemy-color>
            </label>
            <div class="field-row">
              <label class="editor-field">
                <span>Vida</span>
                <input type="number" data-enemy-health min="1" max="50" step="1">
              </label>
              <label class="editor-field">
                <span>Velocidade</span>
                <input type="number" data-enemy-speed min="10" max="300" step="5">
              </label>
            </div>
            <label class="editor-field">
              <span>Dano de contato</span>
              <input type="number" data-enemy-damage min="1" max="10" step="1">
            </label>
          </section>
        </aside>
      </main>

      <footer class="status-bar" data-testid="status" data-tone="ready" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span data-status-text>Carregando projeto…</span>
        <span class="status-spacer"></span>
        <span class="save-state" data-save-state>Autosave local</span>
      </footer>
    </div>
  `;
}

function collectElements(root: HTMLElement): EditorElements {
  return {
    projectName: required(root, "[data-testid='project-name']", "nome do projeto"),
    seed: required(root, "[data-testid='seed-input']", "seed"),
    playerPrimary: required(root, "[data-player-primary]", "cor principal"),
    playerSecondary: required(root, "[data-player-secondary]", "cor secundária"),
    playerHealth: required(root, "[data-player-health]", "vida do jogador"),
    playerSpeed: required(root, "[data-player-speed]", "velocidade do jogador"),
    enemyName: required(root, "[data-enemy-name]", "nome do inimigo"),
    enemyColor: required(root, "[data-enemy-color]", "cor do inimigo"),
    enemyHealth: required(root, "[data-enemy-health]", "vida do inimigo"),
    enemySpeed: required(root, "[data-enemy-speed]", "velocidade do inimigo"),
    enemyDamage: required(root, "[data-enemy-damage]", "dano do inimigo"),
    skinUpload: required(root, "[data-testid='skin-upload']", "upload de skin"),
    skinPreview: required(root, "[data-skin-preview]", "prévia da skin"),
    skinMetadata: required(root, "[data-skin-metadata]", "dados da skin"),
    undo: required(root, "[data-testid='undo']", "botão Desfazer"),
    redo: required(root, "[data-testid='redo']", "botão Refazer"),
    play: required(root, "[data-testid='play-game']", "botão Jogar"),
    pause: required(root, "[data-testid='pause-game']", "botão Pausar"),
    restart: required(root, "[data-testid='restart-game']", "botão Reiniciar"),
    exportProject: required(root, "[data-testid='export-project']", "exportar projeto"),
    importProject: required(root, "[data-testid='import-project']", "importar projeto"),
    preview: required(root, "[data-testid='game-preview']", "prévia do jogo"),
    metrics: required(root, ".preview-metrics", "métricas da prévia"),
    previewStatus: required(root, "[data-preview-status]", "estado da prévia"),
    statusBar: required(root, "[data-testid='status']", "barra de estado"),
    statusText: required(root, "[data-status-text]", "mensagem de estado"),
    saveState: required(root, "[data-save-state]", "estado do autosave"),
  };
}

function renderSkin(
  preview: HTMLElement,
  metadata: HTMLElement,
  skin: ReturnType<typeof readEditorProject>["playerSkin"],
  primary: string,
  secondary: string,
): void {
  preview.replaceChildren();
  metadata.replaceChildren();

  if (skin) {
    const image = document.createElement("img");
    image.src = skin.dataUrl;
    image.alt = `Skin ${skin.filename}`;
    preview.append(image);

    const name = document.createElement("strong");
    name.textContent = skin.filename;
    metadata.append(name);
    metadata.append(
      skin.width && skin.height
        ? `${skin.width}×${skin.height}px`
        : "PNG personalizado",
    );
    return;
  }

  const fallback = document.createElement("span");
  fallback.className = "skin-preview__fallback";
  fallback.style.setProperty("--skin-primary", primary);
  fallback.style.setProperty("--skin-secondary", secondary);
  preview.append(fallback);

  const name = document.createElement("strong");
  name.textContent = "Skin procedural";
  metadata.append(name, "Use suas cores ou envie um PNG.");
}

function renderPreviewStatus(
  elements: EditorElements,
  status: GamePreviewStatus,
): void {
  elements.previewStatus.textContent = `${status.label} · seed ${status.seed}`;
}

function renderPreviewMetrics(
  container: HTMLElement,
  snapshot: GamePreviewSnapshot,
): void {
  container.replaceChildren();
  const metrics = [
    ["Vida", `${snapshot.health}/${snapshot.maxHealth}`],
    ["Inimigos", String(snapshot.enemyCount)],
    ["Projéteis", String(snapshot.projectileCount)],
    ["Tempo", `${Math.floor(snapshot.elapsedTimeMs / 1000)}s`],
  ] as const;

  for (const [label, value] of metrics) {
    const item = document.createElement("span");
    item.append(`${label}: `);
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(strong);
    container.append(item);
  }
}

function numberFromInput(input: HTMLInputElement): number {
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    throw new Error(`“${input.value}” não é um número válido.`);
  }
  return value;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Erro inesperado.";
}

function required<T extends Element>(
  root: ParentNode,
  selector: string,
  label: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Elemento obrigatório ausente: ${label}.`);
  }
  return element;
}
