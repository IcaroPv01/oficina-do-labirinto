import "./editor/editor.css";

import {
  cloneGameProject,
  DEFAULT_GAME_PROJECT,
  parseGameProject,
  type GameProject,
  type RoomKind,
} from "./core";
import type {
  GamePreviewAnnouncement,
  GamePreviewHandle,
  GamePreviewSnapshot,
  GamePreviewStatus,
} from "./game";
import { downloadGamepack, parseGamepack } from "./editor/gamepack";
import { EditorHistory, type HistorySnapshot } from "./editor/history";
import {
  readValidatedPng,
  validateEmbeddedPngDataUrl,
} from "./editor/image-upload";
import {
  createDungeonMap,
  type DungeonMapHandle,
} from "./editor/dungeon-map";
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
  readonly runEndless: HTMLInputElement;
  readonly floorLimit: HTMLInputElement;
  readonly roomsPerFloor: HTMLInputElement;
  readonly startingCoins: HTMLInputElement;
  readonly startingKeys: HTMLInputElement;
  readonly shopHeartCost: HTMLInputElement;
  readonly skinUpload: HTMLInputElement;
  readonly skinLicense: HTMLSelectElement;
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
  readonly dungeonMap: HTMLElement;
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
  let shouldPersistMigration = false;

  try {
    const stored = await loadAutosave<unknown>();
    if (stored) {
      const restoredProject = parseGameProject(stored.project);
      shouldPersistMigration =
        restoredProject.player.skinDataUrl !== null &&
        restoredProject.player.skinMetadata === null;
      project = await validateProjectSkin(restoredProject);
      restoredAt = stored.updatedAt;
    }
  } catch (cause: unknown) {
    setStatus(
      `O autosave não pôde ser restaurado. ${errorMessage(cause)}`,
      "error",
    );
  }

  const history = new EditorHistory<GameProject>(project, 75, cloneGameProject);
  let gamePreview: GamePreviewHandle | null = null;
  let dungeonMap: DungeonMapHandle | null = null;
  let dungeonMapStateKey = "";
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
  if (shouldPersistMigration) {
    autosave.schedule(project);
  }

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

    elements.runEndless.checked = fields.run.endless;
    elements.floorLimit.value = String(fields.run.floorLimit);
    elements.floorLimit.disabled = fields.run.endless;
    elements.roomsPerFloor.value = String(fields.run.roomsPerFloor);
    elements.startingCoins.value = String(fields.run.startingCoins);
    elements.startingKeys.value = String(fields.run.startingKeys);
    elements.shopHeartCost.value = String(fields.run.shopHeartCost);

    renderSkin(
      elements.skinPreview,
      elements.skinMetadata,
      fields.playerSkin,
      fields.playerPrimaryColor,
      fields.playerSecondaryColor,
    );
    elements.skinLicense.disabled = fields.playerSkin === null;
    elements.skinLicense.value = fields.playerSkin?.license ?? "unverified";
  };

  const applySnapshot = (
    snapshot: HistorySnapshot<GameProject>,
    message: string,
  ): void => {
    renderProject(snapshot);
    gamePreview?.updateProject(project);
    autosave.schedule(project);
    setStatus(message);
  };

  const commit = (
    patch: EditorProjectPatch,
    message: string,
  ): void => {
    try {
      const draft = patchEditorProject(project, patch);
      const nextProject = parseGameProject(draft);
      applySnapshot(history.push(nextProject), message);
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
      commit(createPatch(numberFromInput(input)), message);
    } catch (cause: unknown) {
      renderProject(history.snapshot);
      setStatus(`Valor inválido. ${errorMessage(cause)}`, "error");
    }
  };

  renderProject(history.snapshot);

  try {
    const { createGamePreview } = await import("./game");
    gamePreview = createGamePreview(elements.preview, project, {
      autoFocus: false,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      onStatusChange(status: GamePreviewStatus) {
        renderPreviewStatus(elements, status);
        previewPaused = status.phase === "paused";
        const terminal =
          status.phase === "victory" ||
          status.phase === "game-over" ||
          status.phase === "destroyed";
        elements.play.disabled = terminal;
        elements.pause.disabled = terminal;
        elements.pause.textContent = previewPaused ? "Continuar" : "Pausar";
      },
      onAnnouncement(announcement: GamePreviewAnnouncement) {
        setStatus(
          announcement.message,
          announcement.tone === "error"
            ? "error"
            : announcement.tone === "warning"
              ? "working"
              : "ready",
        );
      },
      onSnapshot(snapshot: GamePreviewSnapshot) {
        renderPreviewMetrics(elements.metrics, snapshot);
        const nextMapStateKey = [
          snapshot.dungeon.seed,
          snapshot.floor,
          snapshot.currentRoomId,
          ...snapshot.visitedRoomIds,
          ...snapshot.dungeon.rooms.map(
            (room) => `${room.id}:${room.kind}:${room.x},${room.y}`,
          ),
        ].join(":");
        if (nextMapStateKey !== dungeonMapStateKey) {
          dungeonMapStateKey = nextMapStateKey;
          const options = {
            currentRoomId: snapshot.currentRoomId,
            visitedRoomIds: snapshot.visitedRoomIds,
            onRoomSelect(room: { readonly kind: RoomKind; readonly id: string }) {
              setStatus(
                `${roomKindLabel(room.kind)} selecionada no mapa (${room.id}). O mapa é informativo; use as portas no jogo para viajar.`,
              );
            },
          };
          if (dungeonMap) {
            dungeonMap.update(snapshot.dungeon, options);
          } else {
            dungeonMap = createDungeonMap(
              elements.dungeonMap,
              snapshot.dungeon,
              options,
            );
          }
        }
      },
    });
  } catch (cause: unknown) {
    elements.preview.replaceChildren();
    elements.play.disabled = true;
    elements.pause.disabled = true;
    elements.restart.disabled = true;
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

  elements.runEndless.addEventListener("change", () => {
    commit(
      { run: { endless: elements.runEndless.checked } },
      elements.runEndless.checked
        ? "Modo sem fim ativado."
        : "Modo com expedição final ativado.",
    );
  });
  elements.floorLimit.addEventListener("change", () => {
    commitNumericInput(
      elements.floorLimit,
      (value) => ({ run: { floorLimit: value } }),
      "Quantidade de andares atualizada.",
    );
  });
  elements.roomsPerFloor.addEventListener("change", () => {
    commitNumericInput(
      elements.roomsPerFloor,
      (value) => ({ run: { roomsPerFloor: value } }),
      "Quantidade de salas por andar atualizada.",
    );
  });
  elements.startingCoins.addEventListener("change", () => {
    commitNumericInput(
      elements.startingCoins,
      (value) => ({ run: { startingCoins: value } }),
      "Moedas iniciais atualizadas.",
    );
  });
  elements.startingKeys.addEventListener("change", () => {
    commitNumericInput(
      elements.startingKeys,
      (value) => ({ run: { startingKeys: value } }),
      "Chaves iniciais atualizadas.",
    );
  });
  elements.shopHeartCost.addEventListener("change", () => {
    commitNumericInput(
      elements.shopHeartCost,
      (value) => ({ run: { shopHeartCost: value } }),
      "Preço do coração atualizado.",
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
  elements.skinLicense.addEventListener("change", () => {
    const license = elements.skinLicense.value;
    if (
      license !== "unverified" &&
      license !== "original" &&
      license !== "cc0" &&
      license !== "cc-by" &&
      license !== "cc-by-sa"
    ) {
      setStatus("Licença de skin inválida.", "error");
      return;
    }
    commit(
      { playerSkinLicense: license },
      license === "unverified"
        ? "A licença da skin ficou pendente de confirmação."
        : "Licença da skin registrada no projeto.",
    );
  });

  elements.undo.addEventListener("click", () => {
    applySnapshot(history.undo(), "Última mudança desfeita.");
  });
  elements.redo.addEventListener("click", () => {
    applySnapshot(history.redo(), "Mudança refeita.");
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
    setStatus(
      "Gamepack exportado. Envie-o ao colaborador ou aplique-o numa branch local.",
    );
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
      const importedProject = await validateProjectSkin(
        parseGamepack(await file.text(), parseGameProject),
      );
      applySnapshot(
        history.reset(importedProject),
        `Projeto “${readEditorProject(importedProject).name}” importado.`,
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
  window.addEventListener("pagehide", (event) => {
    void autosave.flush();
    if (!event.persisted) {
      void autosave.dispose();
      dungeonMap?.destroy();
      gamePreview?.destroy();
    }
  });

  const appShell = required<HTMLElement>(root, "[data-app-shell]", "aplicação");
  appShell.removeAttribute("inert");
  appShell.setAttribute("aria-busy", "false");
  appShell.setAttribute("data-testid", "app-ready");
}

function applicationTemplate(): string {
  return `
    <div class="editor-shell" data-app-shell inert aria-busy="true">
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
            <small>A mesma seed reproduz a mesma expedição.</small>
          </label>
          <hr class="editor-divider">
          <h3>Expedição</h3>
          <label class="toggle-field">
            <input type="checkbox" data-run-endless>
            <span>Modo sem fim</span>
          </label>
          <div class="field-row">
            <label class="editor-field">
              <span>Andares</span>
              <input type="number" data-floor-limit min="1" max="99" step="1">
            </label>
            <label class="editor-field">
              <span>Salas/andar</span>
              <input type="number" data-rooms-per-floor min="5" max="24" step="1">
            </label>
          </div>
          <div class="field-row">
            <label class="editor-field">
              <span>Moedas iniciais</span>
              <input type="number" data-starting-coins min="0" max="99" step="1">
            </label>
            <label class="editor-field">
              <span>Chaves iniciais</span>
              <input type="number" data-starting-keys min="1" max="9" step="1">
            </label>
          </div>
          <label class="editor-field">
            <span>Preço do coração</span>
            <input type="number" data-shop-heart-cost min="1" max="99" step="1">
          </label>
          <div class="dungeon-map-host" data-dungeon-map>
            <p class="field-help">O mapa aparecerá assim que a prévia iniciar.</p>
          </div>
          <hr class="editor-divider">
          <h3>Histórico</h3>
          <p class="field-help">Até 75 mudanças podem ser desfeitas nesta sessão. Importar um projeto inicia um novo histórico.</p>
          <hr class="editor-divider">
          <h3>Colaboração</h3>
          <p class="field-help">Exporte o gamepack para enviá-lo ao colaborador. Quem tiver o repositório aplica o arquivo numa branch e abre um pull request. Nada é enviado automaticamente.</p>
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
          <p class="preview-controls" id="preview-controls">Clique no jogo para controlar. WASD move e usa portas; setas atiram; Espaço interage na loja e após o chefe; Esc pausa; R reinicia.</p>
          <div class="preview-metrics" aria-label="Estado da partida"></div>
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
            <label class="editor-field">
              <span>Origem/licença da skin</span>
              <select data-skin-license disabled>
                <option value="unverified">Ainda não confirmada</option>
                <option value="original">Criação própria</option>
                <option value="cc0">CC0 / domínio público</option>
                <option value="cc-by">CC BY</option>
                <option value="cc-by-sa">CC BY-SA</option>
              </select>
              <small>Confirme a licença antes de tornar o repositório público.</small>
            </label>
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
        <a class="license-link" href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">Licenças</a>
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
    runEndless: required(root, "[data-run-endless]", "modo sem fim"),
    floorLimit: required(root, "[data-floor-limit]", "quantidade de andares"),
    roomsPerFloor: required(root, "[data-rooms-per-floor]", "salas por andar"),
    startingCoins: required(root, "[data-starting-coins]", "moedas iniciais"),
    startingKeys: required(root, "[data-starting-keys]", "chaves iniciais"),
    shopHeartCost: required(root, "[data-shop-heart-cost]", "preço do coração"),
    skinUpload: required(root, "[data-testid='skin-upload']", "upload de skin"),
    skinLicense: required(root, "[data-skin-license]", "licença da skin"),
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
    dungeonMap: required(root, "[data-dungeon-map]", "mapa da dungeon"),
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
    const details = [
      skin.width && skin.height
        ? `${skin.width}×${skin.height}px`
        : "PNG personalizado",
    ];
    if (skin.bytes) {
      details.push(formatBytes(skin.bytes));
    }
    details.push(
      skin.license === "unverified"
        ? "licença a confirmar"
        : `licença ${skin.license}`,
    );
    metadata.append(details.join(" · "));
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
    ["Andar", String(snapshot.floor)],
    ["Sala", roomKindLabel(snapshot.roomKind)],
    ["Vida", `${snapshot.health}/${snapshot.maxHealth}`],
    ["Inimigos", String(snapshot.enemyCount)],
    ["Moedas", String(snapshot.coins)],
    ["Chaves", String(snapshot.keys)],
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

async function validateProjectSkin(project: GameProject): Promise<GameProject> {
  const validated = await validateEmbeddedPngDataUrl(project.player.skinDataUrl);
  const metadata = project.player.skinMetadata;

  if (validated === null) {
    if (metadata !== null) {
      throw new Error("A skin possui metadados, mas a imagem está ausente.");
    }
    return project;
  }

  if (metadata === null) {
    return {
      ...project,
      player: {
        ...project.player,
        skinMetadata: {
          filename: "skin-importada.png",
          width: validated.width,
          height: validated.height,
          bytes: validated.bytes,
          sha256: validated.sha256,
          origin: "user-upload",
          license: "unverified",
        },
      },
    };
  }

  if (
    metadata.width !== validated.width ||
    metadata.height !== validated.height ||
    metadata.bytes !== validated.bytes ||
    metadata.sha256 !== validated.sha256
  ) {
    throw new Error("A skin não corresponde aos metadados gravados no projeto.");
  }
  return project;
}

function roomKindLabel(kind: RoomKind): string {
  switch (kind) {
    case "start":
      return "Início";
    case "combat":
      return "Combate";
    case "treasure":
      return "Tesouro";
    case "shop":
      return "Loja";
    case "boss":
      return "Chefe";
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
