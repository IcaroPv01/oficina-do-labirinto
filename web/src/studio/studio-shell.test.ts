import { describe, expect, it, vi } from "vitest";
import type { StudioShellModel } from "./model";
import {
  createStudioShell,
  deriveApprovalControl,
  resolveStudioLayout,
  tabIndexFromKeyboard,
} from "./studio-shell";

describe("deriveApprovalControl", () => {
  it("habilita o dono somente para a revisão exata validada e testada", () => {
    const state = deriveApprovalControl(createModel());

    expect(state).toEqual({
      visible: true,
      disabled: false,
      label: "Aprovar para o jogo",
      reason: "A revisão testada está pronta para seguir ao pipeline de publicação.",
    });
  });

  it("invalida a aprovação quando a candidata muda após o teste", () => {
    const model = createModel({
      approval: {
        candidateRevisionId: "rev-2",
        testedRevisionId: "rev-1",
        validationState: "passed",
        unresolvedProblemCount: 0,
        isPublishing: false,
      },
      proposals: [
        {
          ...createModel().proposals[0]!,
          revisionId: "rev-2",
        },
      ],
    });

    expect(deriveApprovalControl(model)).toMatchObject({
      disabled: true,
      reason: expect.stringMatching(/revisão exata/i),
    });
  });

  it("não expõe a ação final ao coautor", () => {
    const state = deriveApprovalControl(createModel({ role: "coauthor" }));

    expect(state.visible).toBe(false);
    expect(state.reason).toMatch(/exclusiva do dono/i);
  });
});

describe("tabIndexFromKeyboard", () => {
  it("navega circularmente por setas, Home e End", () => {
    expect(tabIndexFromKeyboard("ArrowRight", 2, 3)).toBe(0);
    expect(tabIndexFromKeyboard("ArrowLeft", 0, 3)).toBe(2);
    expect(tabIndexFromKeyboard("Home", 2, 3)).toBe(0);
    expect(tabIndexFromKeyboard("End", 0, 3)).toBe(2);
    expect(tabIndexFromKeyboard("Enter", 0, 3)).toBeNull();
  });
});

describe("resolveStudioLayout", () => {
  it("respeita preferência manual e usa largura mais ponteiro no automático", () => {
    expect(
      resolveStudioLayout("desktop", {
        containerWidth: 390,
        viewportWidth: 390,
        coarsePointer: true,
      }),
    ).toBe("desktop");
    expect(
      resolveStudioLayout("mobile", {
        containerWidth: 1_440,
        viewportWidth: 1_440,
        coarsePointer: false,
      }),
    ).toBe("mobile");
    expect(
      resolveStudioLayout("auto", {
        containerWidth: 390,
        viewportWidth: 390,
        coarsePointer: true,
      }),
    ).toBe("mobile");
    expect(
      resolveStudioLayout("auto", {
        containerWidth: 960,
        viewportWidth: 960,
        coarsePointer: false,
      }),
    ).toBe("desktop");
    expect(
      resolveStudioLayout("auto", {
        containerWidth: 960,
        viewportWidth: 960,
        coarsePointer: true,
      }),
    ).toBe("mobile");
  });
});

describe("createStudioShell", () => {
  it("monta regiões, seletores e abas acessíveis sem HTML injetado", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");

    createStudioShell(
      container as unknown as HTMLElement,
      createModel(),
    );

    expect(findOne(container, (node) => node.dataset.studioShell === "ready"))
      .toBeDefined();
    expect(findAll(container, (node) => node.getAttribute("role") === "tab"))
      .toHaveLength(7);
    expect(
      findOne(
        container,
        (node) => node.getAttribute("aria-label") === "Presença da equipe",
      ),
    ).toBeDefined();
    expect(
      findOne(
        container,
        (node) => node.getAttribute("aria-label") === "Conversa com a assistente IA",
      ),
    ).toBeDefined();
    expect(
      findOne(
        container,
        (node) => node.dataset.studioPreviewSlot === "candidate",
      )?.getAttribute("role"),
    ).toBe("region");
    expect(findAll(container, (node) => node.type === "radio")).toHaveLength(2);
  });

  it("oferece encerramento explícito da sessão autenticada", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onLogout = vi.fn();

    createStudioShell(
      container as unknown as HTMLElement,
      createModel(),
      { onLogout },
    );

    const logout = findOne(
      container,
      (node) => node.textContent === "Encerrar sessão",
    );
    expect(logout).toBeDefined();
    logout?.dispatch("click");
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("mantém a aprovação habilitada somente para o dono e envia a revisão exata", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onApprove = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel(),
      { onApprove },
    );

    const approve = findOne(
      container,
      (node) => node.dataset.testid === "studio-approve",
    );
    expect(approve?.disabled).toBe(false);
    approve?.dispatch("click");
    expect(onApprove).toHaveBeenCalledWith({
      workspaceId: "oficina",
      proposalId: "proposal-1",
      revisionId: "rev-1",
    });

    const coauthorContainer = document.createElement("div");
    createStudioShell(
      coauthorContainer as unknown as HTMLElement,
      createModel({ role: "coauthor" }),
    );
    expect(
      findOne(
        coauthorContainer,
        (node) => node.dataset.testid === "studio-approve",
      ),
    ).toBeUndefined();
  });

  it("seleciona uma proposta e promove a comparação para candidata", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onSelectProposal = vi.fn();
    const model = createModel({
      selectedProposalId: null,
      comparisonTarget: "current",
      approval: {
        candidateRevisionId: null,
        testedRevisionId: null,
        validationState: "pending",
        unresolvedProblemCount: 0,
        isPublishing: false,
      },
    });
    createStudioShell(
      container as unknown as HTMLElement,
      model,
      { onSelectProposal },
    );

    findOne(
      container,
      (node) => node.dataset.proposalId === "proposal-1",
    )?.dispatch("click");

    expect(onSelectProposal).toHaveBeenCalledWith("proposal-1");
    expect(
      findOne(
        container,
        (node) => node.dataset.studioPreviewSlot === "candidate",
      ),
    ).toBeDefined();
  });

  it("oferece navegação móvel completa e controles de toque rotulados", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onMobileViewChange = vi.fn();
    const onSandboxControl = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ layoutPreference: "mobile", mobileView: "project" }),
      { onMobileViewChange, onSandboxControl },
    );

    const root = findOne(
      container,
      (node) => node.dataset.studioShell === "ready",
    );
    expect(root?.dataset.layout).toBe("mobile");
    expect(
      findOne(
        container,
        (node) =>
          node.getAttribute("aria-label") === "Navegação móvel do Estúdio",
      ),
    ).toBeDefined();
    const navigationButtons = findAll(
      container,
      (node) => node.className === "studio-mobile-nav__button",
    );
    expect(navigationButtons).toHaveLength(4);
    expect(
      navigationButtons.find(
        (button) => button.getAttribute("aria-current") === "page",
      )?.dataset.mobileView,
    ).toBe("project");

    navigationButtons
      .find((button) => button.dataset.mobileView === "collaboration")
      ?.dispatch("click");
    expect(onMobileViewChange).toHaveBeenCalledWith("collaboration");
    expect(root?.dataset.mobileView).toBe("collaboration");

    const touchButtons = findAll(
      container,
      (node) => node.className === "studio-touch-button",
    );
    expect(touchButtons).toHaveLength(7);
    expect(touchButtons.every((button) => Boolean(button.getAttribute("aria-label"))))
      .toBe(true);
    const fire = touchButtons.find(
      (button) => button.dataset.control === "fire",
    );
    fire?.dispatch("pointerdown");
    fire?.dispatch("pointerup");
    expect(onSandboxControl).toHaveBeenNthCalledWith(1, {
      control: "fire",
      phase: "start",
    });
    expect(onSandboxControl).toHaveBeenNthCalledWith(2, {
      control: "fire",
      phase: "end",
    });
  });

  it("troca o modo sem perder o rascunho do chat", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onLayoutPreferenceChange = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({
        layoutPreference: "mobile",
        mobileView: "collaboration",
        rightPanelTab: "chat",
      }),
      { onLayoutPreferenceChange },
    );

    const chatInput = findOne(
      container,
      (node) => node.placeholder.startsWith("Escreva uma mensagem"),
    );
    expect(chatInput).toBeDefined();
    if (chatInput) {
      chatInput.value = "Não perder este rascunho";
      chatInput.dispatch("input");
    }
    const selector = findOne(
      container,
      (node) => node.getAttribute("aria-label") === "Modo de layout",
    );
    if (selector) {
      selector.value = "desktop";
      selector.dispatch("change");
    }

    expect(onLayoutPreferenceChange).toHaveBeenCalledWith("desktop");
    expect(
      findOne(
        container,
        (node) => node.dataset.studioShell === "ready",
      )?.dataset.layout,
    ).toBe("desktop");
    expect(
      findOne(
        container,
        (node) => node.placeholder.startsWith("Escreva uma mensagem"),
      )?.value,
    ).toBe("Não perder este rascunho");
  });
});

function createModel(
  overrides: Partial<StudioShellModel> = {},
): StudioShellModel {
  return {
    workspaceId: "oficina",
    projectName: "Oficina do Labirinto",
    currentUserId: "owner-1",
    role: "owner",
    connectionState: "connected",
    publishedVersion: "v0.1.0",
    deploymentLabel: "há 5 minutos",
    members: [
      {
        id: "owner-1",
        displayName: "Ícaro",
        initials: "IV",
        presence: "online",
        currentContext: "Testando proposta",
      },
      {
        id: "friend-1",
        displayName: "Amigo",
        initials: "AM",
        presence: "idle",
      },
    ],
    proposals: [
      {
        id: "proposal-1",
        revisionId: "rev-1",
        title: "Patrulha do morcego",
        summary: "Adiciona um comportamento simples e determinístico.",
        authorName: "Amigo",
        updatedAtLabel: "agora",
        status: "testing",
        changeCount: 2,
        problemCount: 0,
      },
    ],
    selectedProposalId: "proposal-1",
    comparisonTarget: "candidate",
    rightPanelTab: "inspector",
    bottomPanelTab: "changes",
    mobileView: "sandbox",
    layoutPreference: "auto",
    inspector: {
      selectionLabel: "Morcego",
      description: "Inimigo selecionado na proposta.",
      fields: [
        { id: "speed", label: "Velocidade", value: "120" },
      ],
    },
    chat: {
      channelId: "proposal-1",
      channelLabel: "Patrulha do morcego",
      canPost: true,
      messages: [
        {
          id: "message-1",
          authorName: "Amigo",
          body: "Reduzi o raio para evitar paredes.",
          createdAtLabel: "14:32",
        },
      ],
    },
    assistant: {
      state: "ready",
      statusLabel: "Pronta",
      canPrompt: true,
      models: [
        {
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          contextWindow: 1_048_576,
        },
      ],
      selectedModelId: "deepseek-v4-flash",
      messages: [],
    },
    changes: [
      { id: "change-1", title: "Comportamento", detail: "chase → patrol" },
    ],
    problems: [],
    tests: [
      { id: "test-1", title: "Schema válido", tone: "success" },
    ],
    activity: [
      { id: "activity-1", title: "Amigo atualizou o morcego" },
    ],
    approval: {
      candidateRevisionId: "rev-1",
      testedRevisionId: "rev-1",
      validationState: "passed",
      unresolvedProblemCount: 0,
      isPublishing: false,
    },
    ...overrides,
  };
}

type FakeListener = (event: FakeEvent) => void;

interface FakeEvent {
  readonly key: string;
  preventDefault(): void;
}

class FakeDocument {
  readonly elements: FakeElement[] = [];
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(this, tagName);
    this.elements.push(element);
    return element;
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.find((element) => element.id === id) ?? null;
  }
}

class FakeElement {
  readonly ownerDocument: FakeDocument;
  readonly tagName: string;
  readonly children: (FakeElement | string)[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, FakeListener[]>();
  className = "";
  id = "";
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  type = "";
  name = "";
  value = "";
  placeholder = "";
  rows = 0;
  tabIndex = 0;
  htmlFor = "";
  parent: FakeElement | null = null;

  constructor(ownerDocument: FakeDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (node instanceof FakeElement) {
        node.parent = this;
      }
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length);
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, key = ""): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ key, preventDefault() {} });
    }
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  remove(): void {
    if (!this.parent) {
      return;
    }
    const index = this.parent.children.indexOf(this);
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
    this.parent = null;
  }
}

function findAll(
  root: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement[] {
  const matches: FakeElement[] = [];
  if (predicate(root)) {
    matches.push(root);
  }
  for (const child of root.children) {
    if (child instanceof FakeElement) {
      matches.push(...findAll(child, predicate));
    }
  }
  return matches;
}

function findOne(
  root: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement | undefined {
  return findAll(root, predicate)[0];
}
