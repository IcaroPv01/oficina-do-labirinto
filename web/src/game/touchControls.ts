import type { RunDirection } from "../core";

export interface GameTouchControlCallbacks {
  readonly onMove: (direction: RunDirection, active: boolean) => void;
  readonly onAim: (direction: RunDirection, active: boolean) => void;
  readonly onAction: () => void;
  readonly onPause: () => void;
  readonly onRestart: () => void;
}

export interface GameTouchControlsHandle {
  setPaused(paused: boolean): void;
  destroy(): void;
}

interface DirectionDefinition {
  readonly direction: RunDirection;
  readonly symbol: string;
  readonly label: string;
}

const DIRECTIONS: readonly DirectionDefinition[] = [
  { direction: "north", symbol: "↑", label: "cima" },
  { direction: "west", symbol: "←", label: "esquerda" },
  { direction: "east", symbol: "→", label: "direita" },
  { direction: "south", symbol: "↓", label: "baixo" },
];

/**
 * Creates controls outside the Phaser canvas so they remain accessible to
 * assistive technology and can be used by two simultaneous touch pointers.
 */
export function createGameTouchControls(
  document: Document,
  callbacks: GameTouchControlCallbacks,
): { readonly element: HTMLElement; readonly handle: GameTouchControlsHandle } {
  const root = document.createElement("section");
  root.className = "game-touch-controls";
  root.dataset.testid = "touch-controls";
  root.setAttribute("aria-label", "Controles de toque do jogo");

  const cleanups: Array<() => void> = [];
  const movePad = createDirectionPad(
    document,
    "Movimento",
    "move",
    callbacks.onMove,
    cleanups,
  );
  const aimPad = createDirectionPad(
    document,
    "Disparo",
    "aim",
    callbacks.onAim,
    cleanups,
  );

  const actions = document.createElement("div");
  actions.className = "game-touch-actions";
  actions.setAttribute("aria-label", "Ações do jogo");
  const pauseButton = createActionButton(
    document,
    "Pausar",
    "touch-pause",
    callbacks.onPause,
  );
  actions.append(
    createActionButton(document, "Ação", "touch-action", callbacks.onAction),
    pauseButton,
    createActionButton(document, "Reiniciar", "touch-restart", callbacks.onRestart),
  );

  root.append(movePad, actions, aimPad);

  return {
    element: root,
    handle: {
      setPaused(paused) {
        pauseButton.textContent = paused ? "Continuar" : "Pausar";
        pauseButton.setAttribute("aria-pressed", String(paused));
        pauseButton.setAttribute(
          "aria-label",
          paused ? "Continuar o jogo" : "Pausar o jogo",
        );
      },
      destroy() {
        for (const cleanup of cleanups.splice(0)) {
          cleanup();
        }
        root.remove();
      },
    },
  };
}

function createDirectionPad(
  document: Document,
  title: string,
  testPrefix: "move" | "aim",
  onChange: (direction: RunDirection, active: boolean) => void,
  cleanups: Array<() => void>,
): HTMLElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "game-touch-pad";
  fieldset.dataset.pad = testPrefix;
  const legend = document.createElement("legend");
  legend.textContent = title;
  fieldset.append(legend);

  for (const definition of DIRECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-touch-pad__button";
    button.dataset.direction = definition.direction;
    button.dataset.testid = `touch-${testPrefix}-${definition.direction}`;
    button.textContent = definition.symbol;
    button.setAttribute(
      "aria-label",
      `${title}: ${definition.label}`,
    );
    cleanups.push(bindHoldButton(button, (active) => {
      onChange(definition.direction, active);
    }));
    fieldset.append(button);
  }

  return fieldset;
}

function createActionButton(
  document: Document,
  label: string,
  testId: string,
  callback: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "game-touch-action";
  button.dataset.testid = testId;
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

function bindHoldButton(
  button: HTMLButtonElement,
  onChange: (active: boolean) => void,
): () => void {
  const pointers = new Set<number>();
  let keyboardHeld = false;
  let assistivePulse: ReturnType<typeof setTimeout> | undefined;
  let ignoreSyntheticClickUntil = 0;

  const isActive = (): boolean => pointers.size > 0 || keyboardHeld || assistivePulse !== undefined;

  const updatePressedState = (): void => {
    if (isActive()) {
      button.dataset.pressed = "true";
    } else {
      delete button.dataset.pressed;
    }
  };

  const activatePointer = (event: PointerEvent): void => {
    event.preventDefault();
    if (pointers.has(event.pointerId)) {
      return;
    }
    const wasInactive = !isActive();
    pointers.add(event.pointerId);
    ignoreSyntheticClickUntil = performance.now() + 500;
    updatePressedState();
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and older WebViews may not implement pointer capture.
    }
    if (wasInactive) {
      onChange(true);
    }
  };

  const releasePointer = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) {
      return;
    }
    if (pointers.size === 0) {
      updatePressedState();
      if (!keyboardHeld && assistivePulse === undefined) {
        onChange(false);
      }
    }
  };

  const keyDown = (event: KeyboardEvent): void => {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) {
      return;
    }
    event.preventDefault();
    if (!keyboardHeld) {
      const wasInactive = !isActive();
      keyboardHeld = true;
      ignoreSyntheticClickUntil = performance.now() + 500;
      updatePressedState();
      if (wasInactive) {
        onChange(true);
      }
    }
  };

  const keyUp = (event: KeyboardEvent): void => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (keyboardHeld) {
      keyboardHeld = false;
      updatePressedState();
      if (pointers.size === 0 && assistivePulse === undefined) {
        onChange(false);
      }
    }
  };

  const releaseKeyboard = (): void => {
    if (!keyboardHeld) {
      return;
    }
    keyboardHeld = false;
    updatePressedState();
    if (pointers.size === 0 && assistivePulse === undefined) {
      onChange(false);
    }
  };

  const releaseAll = (): void => {
    const wasActive = isActive();
    pointers.clear();
    keyboardHeld = false;
    if (assistivePulse !== undefined) {
      clearTimeout(assistivePulse);
      assistivePulse = undefined;
    }
    updatePressedState();
    if (wasActive) {
      onChange(false);
    }
  };

  const click = (event: MouseEvent): void => {
    // Pointer and keyboard activation are already represented by hold events.
    // A detail=0 click outside that window is typically emitted by assistive
    // technology, so turn it into a short, deterministic press.
    if (event.detail !== 0 || performance.now() < ignoreSyntheticClickUntil) {
      return;
    }
    event.preventDefault();
    if (!isActive()) {
      onChange(true);
    }
    if (assistivePulse !== undefined) {
      clearTimeout(assistivePulse);
    }
    assistivePulse = setTimeout(() => {
      assistivePulse = undefined;
      updatePressedState();
      if (pointers.size === 0 && !keyboardHeld) {
        onChange(false);
      }
    }, 160);
    updatePressedState();
  };

  const visibilityChange = (): void => {
    if (button.ownerDocument.visibilityState === "hidden") {
      releaseAll();
    }
  };

  const contextMenu = (event: Event): void => {
    event.preventDefault();
  };

  button.addEventListener("pointerdown", activatePointer);
  button.addEventListener("pointerup", releasePointer);
  button.addEventListener("pointercancel", releasePointer);
  button.addEventListener("lostpointercapture", releasePointer);
  button.addEventListener("keydown", keyDown);
  button.addEventListener("keyup", keyUp);
  button.addEventListener("blur", releaseKeyboard);
  button.addEventListener("click", click);
  button.addEventListener("contextmenu", contextMenu);
  button.ownerDocument.addEventListener("visibilitychange", visibilityChange);
  button.ownerDocument.defaultView?.addEventListener("blur", releaseAll);

  return () => {
    releaseAll();
    button.removeEventListener("pointerdown", activatePointer);
    button.removeEventListener("pointerup", releasePointer);
    button.removeEventListener("pointercancel", releasePointer);
    button.removeEventListener("lostpointercapture", releasePointer);
    button.removeEventListener("keydown", keyDown);
    button.removeEventListener("keyup", keyUp);
    button.removeEventListener("blur", releaseKeyboard);
    button.removeEventListener("click", click);
    button.removeEventListener("contextmenu", contextMenu);
    button.ownerDocument.removeEventListener("visibilitychange", visibilityChange);
    button.ownerDocument.defaultView?.removeEventListener("blur", releaseAll);
  };
}
