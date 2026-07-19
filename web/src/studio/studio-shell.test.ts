import { describe, expect, it, vi } from "vitest";
import type { StudioShellModel } from "./model";
import {
  createStudioShell,
  deriveApprovalControl,
  projectFileMatchesSearch,
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

describe("projectFileMatchesSearch", () => {
  it("busca sem diferenciar caixa no nome e no caminho", () => {
    const entry = { name: "README.md", path: "docs/README.md" };
    expect(projectFileMatchesSearch(entry, "readme")).toBe(true);
    expect(projectFileMatchesSearch(entry, "DOCS/")).toBe(true);
    expect(projectFileMatchesSearch(entry, "sprite")).toBe(false);
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
    expect(
      findOne(
        container,
        (node) => node.dataset.studioPreviewHost === "game",
      ),
    ).toBeDefined();
    expect(
      findOne(container, (node) => node.textContent === "CANDIDATA"),
    ).toBeDefined();
    expect(
      findOne(
        container,
        (node) =>
          node.getAttribute("aria-label") ===
          "Evidências do teste da candidata",
      ),
    ).toBeDefined();
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

  it("oferece ao dono convite copiável/compartilhável sem renderizar o token", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onCreateInvite = vi.fn();
    const onCopyInviteLink = vi.fn();
    const onShareInviteLink = vi.fn();
    const shareUrl =
      "https://owner.github.io/game/?studio=1&studioServer=https%3A%2F%2Fstudio.example%2F#invite=inv_secret_once";
    const handle = createStudioShell(
      container as unknown as HTMLElement,
      createModel(),
      { onCreateInvite, onCopyInviteLink, onShareInviteLink },
    );
    findOne(container, (node) => node.textContent === "Convidar amigo")
      ?.dispatch("click");
    handle.update(
      createModel({
        invite: {
          state: "ready",
          statusMessage: "Link pronto para seu amigo.",
          shareUrl,
          expiresAtLabel: "19/07/2026 12:00",
        },
      }),
    );
    findOne(container, (node) => node.textContent === "Copiar link")
      ?.dispatch("click");
    findOne(container, (node) => node.textContent === "Compartilhar")
      ?.dispatch("click");
    expect(onCreateInvite).toHaveBeenCalledOnce();
    expect(onCopyInviteLink).toHaveBeenCalledOnce();
    expect(onShareInviteLink).toHaveBeenCalledOnce();
    expect(findOne(container, (node) => node.textContent.includes("inv_secret_once")))
      .toBeUndefined();
  });

  it("não mostra criação de convite a coautores", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ role: "coauthor" }),
      { onCreateInvite: vi.fn() },
    );
    expect(findOne(container, (node) => node.textContent === "Convidar amigo"))
      .toBeUndefined();
  });

  it("mostra arquivos reais em grupos, busca localmente e nunca lista .env", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onSelectProjectFile = vi.fn();
    const base = createModel();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({
        projectFiles: {
          ...base.projectFiles,
          files: [
            ...base.projectFiles.files,
            {
              path: ".env",
              name: ".env",
              category: "configuration",
              kind: "text",
              mediaType: "text/plain",
              sizeBytes: 12,
              sha256: "f".repeat(64),
            },
          ],
        },
      }),
      { onSelectProjectFile },
    );

    expect(findOne(container, (node) => node.textContent === "Arquivos do projeto"))
      .toBeDefined();
    expect(findOne(container, (node) => node.dataset.projectFilePath === ".env"))
      .toBeUndefined();
    const source = findOne(
      container,
      (node) => node.dataset.projectFilePath === "web/src/main.ts",
    );
    expect(source).toBeDefined();

    const search = findOne(
      container,
      (node) => node.getAttribute("aria-label") === "Buscar arquivos do projeto",
    );
    if (search) {
      search.value = "readme";
      search.dispatch("input");
    }
    expect(source?.hidden).toBe(true);
    const readme = findOne(
      container,
      (node) => node.dataset.projectFilePath === "docs/README.md",
    );
    expect(readme?.hidden).toBe(false);
    readme?.dispatch("click");
    expect(onSelectProjectFile).toHaveBeenCalledWith("docs/README.md");
  });

  it("renderiza texto real escapado com linhas e metadados somente leitura", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const source = "const answer = 42;\nexport { answer };\n";
    const entry = {
      path: "web/src/main.ts",
      name: "main.ts",
      category: "source" as const,
      kind: "text" as const,
      mediaType: "text/typescript" as const,
      sizeBytes: new TextEncoder().encode(source).byteLength,
      sha256: "a".repeat(64),
    };
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({
        projectFiles: {
          state: "ready",
          statusMessage: "Arquivo disponível.",
          files: [entry],
          selectedPath: entry.path,
          contentState: "ready",
          contentMessage: "Arquivo carregado em modo somente leitura.",
          selectedContent: {
            schemaVersion: 1,
            projectId: "oficina",
            entry,
            encoding: "utf8",
            content: source,
          },
        },
      }),
    );

    expect(findOne(container, (node) => node.textContent === "const answer = 42;"))
      .toBeDefined();
    expect(findAll(container, (node) => node.className === "studio-project-file-line"))
      .toHaveLength(3);
    expect(findOne(container, (node) => node.textContent === "a".repeat(64)))
      .toBeDefined();
    expect(
      findOne(
        container,
        (node) => node.textContent.startsWith("Somente leitura."),
      ),
    ).toBeDefined();
  });

  it("usa data URL apenas para bitmap e mantém SVG como texto inerte", () => {
    const bitmapDocument = new FakeDocument();
    const bitmapContainer = bitmapDocument.createElement("div");
    const bitmapEntry = {
      path: "game/assets/player.png",
      name: "player.png",
      category: "asset" as const,
      kind: "image" as const,
      mediaType: "image/png" as const,
      sizeBytes: 1,
      sha256: "c".repeat(64),
    };
    createStudioShell(
      bitmapContainer as unknown as HTMLElement,
      createModel({
        projectFiles: {
          state: "ready",
          statusMessage: "Imagem disponível.",
          files: [bitmapEntry],
          selectedPath: bitmapEntry.path,
          contentState: "ready",
          contentMessage: "Imagem carregada.",
          selectedContent: {
            schemaVersion: 1,
            projectId: "oficina",
            entry: bitmapEntry,
            encoding: "base64",
            content: "AA==",
          },
        },
      }),
    );
    const image = findOne(bitmapContainer, (node) => node.tagName === "IMG") as
      | (FakeElement & { src?: string })
      | undefined;
    expect(image?.src).toBe("data:image/png;base64,AA==");

    const svgDocument = new FakeDocument();
    const svgContainer = svgDocument.createElement("div");
    const svgSource = "<svg><script>alert('não executar')</script></svg>";
    const svgEntry = {
      path: "game/assets/icon.svg",
      name: "icon.svg",
      category: "asset" as const,
      kind: "text" as const,
      mediaType: "image/svg+xml" as const,
      sizeBytes: new TextEncoder().encode(svgSource).byteLength,
      sha256: "d".repeat(64),
    };
    createStudioShell(
      svgContainer as unknown as HTMLElement,
      createModel({
        projectFiles: {
          state: "ready",
          statusMessage: "SVG disponível.",
          files: [svgEntry],
          selectedPath: svgEntry.path,
          contentState: "ready",
          contentMessage: "SVG carregado como texto.",
          selectedContent: {
            schemaVersion: 1,
            projectId: "oficina",
            entry: svgEntry,
            encoding: "utf8",
            content: svgSource,
          },
        },
      }),
    );
    expect(findOne(svgContainer, (node) => node.textContent === svgSource))
      .toBeDefined();
    expect(findOne(svgContainer, (node) => node.tagName === "SCRIPT"))
      .toBeUndefined();
    expect(findOne(svgContainer, (node) => node.tagName === "IMG"))
      .toBeUndefined();
  });

  it("volta do arquivo para a árvore no celular sem perder seleção, rascunho ou sandbox", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const base = createModel();
    const entry = base.projectFiles.files[0]!;
    if (entry.kind !== "text") {
      throw new Error("O fixture deveria começar por um arquivo de texto.");
    }
    const source = "export {};\n";
    const model = createModel({
      layoutPreference: "mobile",
      mobileView: "project",
      rightPanelTab: "chat",
      projectFiles: {
        ...base.projectFiles,
        selectedPath: entry.path,
        contentState: "ready",
        contentMessage: "Arquivo carregado.",
        selectedContent: {
          schemaVersion: 1,
          projectId: "oficina",
          entry: {
            ...entry,
            sizeBytes: new TextEncoder().encode(source).byteLength,
          },
          encoding: "utf8",
          content: source,
        },
      },
    });
    const handle = createStudioShell(
      container as unknown as HTMLElement,
      model,
    );
    const host = handle.sandboxPreviewHost;
    const chatInput = findOne(
      container,
      (node) => node.placeholder.startsWith("Escreva uma mensagem"),
    );
    if (chatInput) {
      chatInput.value = "Rascunho preservado";
      chatInput.dispatch("input");
    }

    findOne(container, (node) => node.textContent === "← Voltar aos arquivos")
      ?.dispatch("click");

    const root = findOne(container, (node) => node.dataset.studioShell === "ready");
    expect(root?.dataset.projectFilesPane).toBe("tree");
    expect(model.projectFiles.selectedPath).toBe(entry.path);
    expect(handle.sandboxPreviewHost).toBe(host);
    expect(
      findOne(
        container,
        (node) => node.placeholder.startsWith("Escreva uma mensagem"),
      )?.value,
    ).toBe("Rascunho preservado");
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

  it("oferece navegação móvel e registra o teste sem duplicar controles do jogo", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onMobileViewChange = vi.fn();
    const onRunSandboxTest = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ layoutPreference: "mobile", mobileView: "project" }),
      { onMobileViewChange, onRunSandboxTest },
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

    expect(
      findAll(
        container,
        (node) => node.className === "studio-touch-button",
      ),
    ).toHaveLength(0);

    const runTest = findOne(
      container,
      (node) => node.dataset.testid === "studio-run-sandbox-test",
    );
    expect(runTest?.disabled).toBe(false);
    runTest?.dispatch("click");
    expect(onRunSandboxTest).toHaveBeenCalledWith({
      workspaceId: "oficina",
      proposalId: "proposal-1",
      revisionId: "rev-1",
    });
  });

  it("preserva o host do Phaser e seu conteúdo durante qualquer update", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const handle = createStudioShell(
      container as unknown as HTMLElement,
      createModel(),
    );
    const previewHost = handle.sandboxPreviewHost as unknown as FakeElement;
    const phaserCanvas = document.createElement("canvas");
    previewHost.append(phaserCanvas);

    handle.update(
      createModel({
        connectionState: "syncing",
        sandbox: {
          previewState: "testing",
          statusMessage: "Executando verificações da revisão rev-1.",
          canRunTest: false,
          checklist: [
            {
              id: "mobile-playthrough",
              label: "Jogabilidade móvel",
              status: "pending",
            },
          ],
        },
      }),
    );

    expect(handle.sandboxPreviewHost).toBe(
      previewHost as unknown as HTMLElement,
    );
    expect(
      findOne(container, (node) => node.dataset.studioPreviewHost === "game"),
    ).toBe(previewHost);
    expect(previewHost.children).toContain(phaserCanvas);
    expect(
      findOne(
        container,
        (node) => node.dataset.previewState === "testing",
      ),
    ).toBeDefined();
  });

  it("mantém o jogo atual jogável mesmo quando a candidata falha", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({
        comparisonTarget: "current",
        sandbox: {
          previewState: "failed",
          statusMessage: "A candidata contém uma operação inválida.",
          canRunTest: true,
          checklist: [],
        },
      }),
    );

    const preview = findOne(
      container,
      (node) => node.dataset.studioPreviewSlot === "current",
    );
    expect(preview?.dataset.previewState).toBe("ready");
    expect(
      findOne(container, (node) => node.textContent === "ATUAL"),
    ).toBeDefined();
    expect(
      findOne(
        container,
        (node) => node.dataset.testid === "studio-run-sandbox-test",
      )?.disabled,
    ).toBe(true);
  });

  it("mantém a conversa humana separada do modo de propor com IA", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onSendChat = vi.fn();
    const onProposeWithAssistant = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ rightPanelTab: "chat" }),
      { onSendChat, onProposeWithAssistant },
    );

    const input = findOne(
      container,
      (node) => node.placeholder.startsWith("Escreva uma mensagem"),
    );
    expect(input).toBeDefined();
    if (input) {
      input.value = "Registrar a decisão com meu amigo";
      input.dispatch("input");
      input.parent?.dispatch("submit");
    }

    expect(onSendChat).toHaveBeenCalledWith(
      "proposal-1",
      "Registrar a decisão com meu amigo",
    );
    expect(onProposeWithAssistant).not.toHaveBeenCalled();
  });

  it("pedir uma proposta não a aceita nem usa o fluxo de pergunta", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onAskAssistant = vi.fn();
    const onProposeWithAssistant = vi.fn();
    const onAcceptAssistantProposal = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ rightPanelTab: "assistant" }),
      {
        onAskAssistant,
        onProposeWithAssistant,
        onAcceptAssistantProposal,
      },
    );

    findOne(
      container,
      (node) => node.textContent === "Propor mudança",
    )?.dispatch("click");
    const input = findOne(
      container,
      (node) => node.placeholder.startsWith("Ex.: proponha"),
    );
    expect(input).toBeDefined();
    if (input) {
      input.value = "Faça o morcego patrulhar a sala";
      input.dispatch("input");
      input.parent?.dispatch("submit");
    }

    expect(onProposeWithAssistant).toHaveBeenCalledWith(
      "Faça o morcego patrulhar a sala",
      "deepseek-v4-flash",
    );
    expect(onAskAssistant).not.toHaveBeenCalled();
    expect(onAcceptAssistantProposal).not.toHaveBeenCalled();
  });

  it("exige aceite explícito antes de pedir a criação do change set", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onAcceptAssistantProposal = vi.fn();
    const onApprove = vi.fn();
    const onRunSandboxTest = vi.fn();
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({
        rightPanelTab: "assistant",
        assistant: {
          ...createModel().assistant,
          pendingProposal: {
            id: "ai-proposal-1",
            title: "Patrulha curta do morcego",
            explanation: "Troca a perseguição por uma rota determinística.",
            operations: ["Definir comportamento do inimigo como patrulha."],
            risks: ["A rota pode encostar em paredes estreitas."],
            status: "ready",
            statusMessage: "Revise antes de adicionar às propostas.",
          },
        },
      }),
      { onAcceptAssistantProposal, onApprove, onRunSandboxTest },
    );

    expect(onAcceptAssistantProposal).not.toHaveBeenCalled();
    findOne(
      container,
      (node) => node.textContent.startsWith("Propor mudança"),
    )?.dispatch("click");
    expect(
      findOne(container, (node) => node.textContent === "NÃO APLICADA"),
    ).toBeDefined();
    expect(
      findOne(
        container,
        (node) => node.textContent === "Definir comportamento do inimigo como patrulha.",
      ),
    ).toBeDefined();
    expect(onAcceptAssistantProposal).not.toHaveBeenCalled();

    findOne(
      container,
      (node) => node.dataset.testid === "studio-accept-assistant-proposal",
    )?.dispatch("click");

    expect(onAcceptAssistantProposal).toHaveBeenCalledWith("ai-proposal-1");
    expect(onApprove).not.toHaveBeenCalled();
    expect(onRunSandboxTest).not.toHaveBeenCalled();
  });

  it("preserva rascunhos independentes ao alternar os modos da IA", () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    createStudioShell(
      container as unknown as HTMLElement,
      createModel({ rightPanelTab: "assistant" }),
    );

    const askInput = findOne(
      container,
      (node) => node.placeholder.startsWith("Ex.: explique"),
    );
    if (askInput) {
      askInput.value = "Como o morcego se move?";
      askInput.dispatch("input");
    }
    findOne(
      container,
      (node) => node.textContent === "Propor mudança",
    )?.dispatch("click");
    const proposeInput = findOne(
      container,
      (node) => node.placeholder.startsWith("Ex.: proponha"),
    );
    if (proposeInput) {
      proposeInput.value = "Mude a rota do morcego";
      proposeInput.dispatch("input");
    }
    findOne(
      container,
      (node) => node.textContent === "Perguntar",
    )?.dispatch("click");
    expect(
      findOne(
        container,
        (node) => node.placeholder.startsWith("Ex.: explique"),
      )?.value,
    ).toBe("Como o morcego se move?");
    findOne(
      container,
      (node) => node.textContent === "Propor mudança",
    )?.dispatch("click");
    expect(
      findOne(
        container,
        (node) => node.placeholder.startsWith("Ex.: proponha"),
      )?.value,
    ).toBe("Mude a rota do morcego");
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
    projectFiles: {
      state: "ready",
      statusMessage: "2 arquivos disponíveis em modo somente leitura.",
      files: [
        {
          path: "web/src/main.ts",
          name: "main.ts",
          category: "source",
          kind: "text",
          mediaType: "text/typescript",
          sizeBytes: 42,
          sha256: "a".repeat(64),
        },
        {
          path: "docs/README.md",
          name: "README.md",
          category: "documentation",
          kind: "text",
          mediaType: "text/markdown",
          sizeBytes: 24,
          sha256: "b".repeat(64),
        },
      ],
      selectedPath: null,
      contentState: "idle",
      contentMessage: "Selecione um arquivo para visualizar seu conteúdo.",
      selectedContent: null,
    },
    invite: {
      state: "idle",
      statusMessage: "Crie um link de uso único para seu amigo.",
      shareUrl: null,
      expiresAtLabel: null,
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
      canPropose: true,
      models: [
        {
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          contextWindow: 1_048_576,
        },
      ],
      selectedModelId: "deepseek-v4-flash",
      messages: [],
      pendingProposal: null,
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
    sandbox: {
      previewState: "ready",
      statusMessage: "A candidata está pronta para jogar no desktop ou celular.",
      canRunTest: true,
      checklist: [
        {
          id: "contract",
          label: "Contrato do projeto",
          detail: "Estrutura válida.",
          status: "passed",
        },
        {
          id: "mobile-playthrough",
          label: "Jogabilidade móvel",
          detail: "Aguardando teste manual.",
          status: "pending",
        },
      ],
    },
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
