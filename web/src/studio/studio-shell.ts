import "./studio.css";
import type {
  ProjectFileCategory,
  ProjectFileEntry,
} from "@collaborative-roguelike/studio-contracts";
import { formatContextWindow } from "./assistant-models";
import type {
  StudioApprovalControlState,
  StudioAssistantMode,
  StudioAssistantProposalStatus,
  StudioBottomPanelTab,
  StudioComparisonTarget,
  StudioLayoutPreference,
  StudioMobileView,
  StudioPanelItem,
  StudioProposalStatus,
  StudioResolvedLayout,
  StudioRightPanelTab,
  StudioSandboxCheckStatus,
  StudioSandboxPreviewState,
  StudioShellHandle,
  StudioShellModel,
  StudioShellOptions,
} from "./model";

export interface StudioLayoutSignals {
  readonly containerWidth: number;
  readonly viewportWidth: number;
  readonly coarsePointer: boolean;
}

interface StudioComposerDrafts {
  chat: string;
  assistantAsk: string;
  assistantPropose: string;
}

const RIGHT_TABS = [
  { id: "inspector", label: "Inspetor" },
  { id: "chat", label: "Conversa" },
  { id: "assistant", label: "Assistente IA" },
] as const satisfies readonly {
  id: StudioRightPanelTab;
  label: string;
}[];

const BOTTOM_TABS = [
  { id: "changes", label: "Alterações" },
  { id: "problems", label: "Problemas" },
  { id: "tests", label: "Testes" },
  { id: "activity", label: "Atividade" },
] as const satisfies readonly {
  id: StudioBottomPanelTab;
  label: string;
}[];

const MOBILE_VIEWS = [
  { id: "project", label: "Projeto", icon: "⌂" },
  { id: "sandbox", label: "Sandbox", icon: "▶" },
  { id: "collaboration", label: "Conversas", icon: "●" },
  { id: "review", label: "Revisão", icon: "✓" },
] as const satisfies readonly {
  id: StudioMobileView;
  label: string;
  icon: string;
}[];

const PROJECT_FILE_CATEGORIES = [
  { id: "source", label: "Código" },
  { id: "game-data", label: "Dados do jogo" },
  { id: "asset", label: "Imagens e assets" },
  { id: "documentation", label: "Documentação" },
  { id: "configuration", label: "Configuração pública" },
] as const satisfies readonly {
  readonly id: ProjectFileCategory;
  readonly label: string;
}[];

const MAX_RENDERED_FILE_LINES = 5_000;
const MAX_RENDERED_TEXT_CHARACTERS = 500_000;

const PROPOSAL_STATUS = {
  draft: { label: "Rascunho", tone: "neutral" },
  ready_for_test: { label: "Pronta para teste", tone: "warning" },
  testing: { label: "Em teste", tone: "warning" },
  changes_requested: { label: "Ajustes solicitados", tone: "warning" },
  approved: { label: "Aprovada", tone: "success" },
  publishing: { label: "Publicando", tone: "warning" },
  published: { label: "Publicada", tone: "success" },
  rejected: { label: "Rejeitada", tone: "error" },
  conflict: { label: "Conflito", tone: "error" },
} as const satisfies Record<
  StudioProposalStatus,
  { readonly label: string; readonly tone: string }
>;

const CONNECTION = {
  connected: { label: "Sincronizado", tone: "success" },
  syncing: { label: "Sincronizando", tone: "warning" },
  offline: { label: "Offline", tone: "neutral" },
  conflict: { label: "Conflito de sincronização", tone: "error" },
} as const;

const SANDBOX_PREVIEW_STATE = {
  preparing: { label: "Preparando", tone: "warning", icon: "…" },
  ready: { label: "Pronto", tone: "success", icon: "✓" },
  testing: { label: "Testando", tone: "warning", icon: "↻" },
  failed: { label: "Falhou", tone: "error", icon: "!" },
} as const satisfies Record<
  StudioSandboxPreviewState,
  { readonly label: string; readonly tone: string; readonly icon: string }
>;

const SANDBOX_CHECK_STATUS = {
  pending: { label: "Pendente", icon: "○" },
  passed: { label: "Passou", icon: "✓" },
  failed: { label: "Falhou", icon: "!" },
} as const satisfies Record<
  StudioSandboxCheckStatus,
  { readonly label: string; readonly icon: string }
>;

const ASSISTANT_PROPOSAL_STATUS = {
  preparing: { label: "Preparando", tone: "warning" },
  ready: { label: "Pronta para revisão", tone: "success" },
  failed: { label: "Falhou", tone: "error" },
} as const satisfies Record<
  StudioAssistantProposalStatus,
  { readonly label: string; readonly tone: string }
>;

let shellSequence = 0;

export function deriveApprovalControl(
  model: StudioShellModel,
): StudioApprovalControlState {
  if (model.role !== "owner") {
    return {
      visible: false,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: "A aprovação final é exclusiva do dono do Estúdio.",
    };
  }

  const selected = model.proposals.find(
    (proposal) => proposal.id === model.selectedProposalId,
  );
  if (!selected || !model.approval.candidateRevisionId) {
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: "Selecione uma proposta candidata para revisar.",
    };
  }

  if (model.approval.isSubmitting) {
    return {
      visible: true,
      disabled: true,
      label: "Aprovando…",
      reason: "Registrando a aprovação desta revisão exata no Estúdio.",
    };
  }

  if (model.approval.isPublishing || selected.status === "publishing") {
    return {
      visible: true,
      disabled: true,
      label: "Publicando…",
      reason: "A revisão aprovada está passando pelas verificações de publicação.",
    };
  }

  if (selected.status !== "testing") {
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: "A proposta precisa estar em teste antes da aprovação.",
    };
  }

  if (selected.revisionId !== model.approval.candidateRevisionId) {
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: "A revisão candidata mudou; prepare e teste novamente o sandbox.",
    };
  }

  if (model.approval.validationState !== "passed") {
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason:
        model.approval.validationState === "failed"
          ? "Corrija as validações que falharam antes de aprovar."
          : "Aguarde as validações automáticas terminarem.",
    };
  }

  if (model.approval.unresolvedProblemCount > 0) {
    const pendingProblems =
      model.approval.unresolvedProblemCount === 1
        ? "1 problema precisa ser resolvido"
        : `${model.approval.unresolvedProblemCount} problemas precisam ser resolvidos`;
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: `${pendingProblems} antes da aprovação.`,
    };
  }

  if (
    model.approval.testedRevisionId !== model.approval.candidateRevisionId
  ) {
    return {
      visible: true,
      disabled: true,
      label: "Aprovar para o jogo",
      reason: "Teste esta revisão exata no sandbox antes de aprovar.",
    };
  }

  return {
    visible: true,
    disabled: false,
    label: "Aprovar para o jogo",
    reason: "A revisão testada está pronta para seguir ao pipeline de publicação.",
  };
}

export function createStudioShell(
  container: HTMLElement,
  initialModel: StudioShellModel,
  options: StudioShellOptions = {},
): StudioShellHandle {
  const document = container.ownerDocument;
  const idPrefix = `studio-${++shellSequence}`;
  const root = document.createElement("section");
  root.className = "studio-shell";
  root.dataset.studioShell = "ready";
  root.dataset.mobileView = initialModel.mobileView;
  root.dataset.projectFilesPane = initialModel.projectFiles.selectedPath
    ? "viewer"
    : "tree";
  root.dataset.projectFileSelected = String(
    initialModel.projectFiles.selectedPath !== null,
  );
  root.dataset.layoutPreference = initialModel.layoutPreference;
  root.dataset.layout = resolveStudioLayout(
    initialModel.layoutPreference,
    readLayoutSignals(container, document),
  );
  root.setAttribute(
    "aria-label",
    `Estúdio colaborativo do projeto ${initialModel.projectName}`,
  );

  let model = initialModel;
  let destroyed = false;
  let assistantMode: StudioAssistantMode = "ask";
  let projectFileSearch = "";
  let projectFilesPane: "tree" | "viewer" = initialModel.projectFiles.selectedPath
    ? "viewer"
    : "tree";
  const drafts: StudioComposerDrafts = {
    chat: "",
    assistantAsk: "",
    assistantPropose: "",
  };
  const sandboxPreviewHost = element(
    document,
    "div",
    "studio-preview__game-host",
  );
  sandboxPreviewHost.dataset.studioPreviewHost = "game";

  const selectProposal = (proposalId: string): void => {
    const proposal = model.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }
    model = {
      ...model,
      selectedProposalId: proposalId,
      comparisonTarget: "candidate",
      approval: {
        ...model.approval,
        candidateRevisionId: proposal.revisionId,
      },
    };
    render();
    options.onSelectProposal?.(proposalId);
  };

  const selectComparison = (target: StudioComparisonTarget): void => {
    if (target === "candidate" && !selectedProposal(model)) {
      return;
    }
    model = { ...model, comparisonTarget: target };
    render(`${idPrefix}-comparison-${target}`);
    options.onComparisonChange?.(target);
  };

  const selectRightTab = (tab: StudioRightPanelTab): void => {
    model = { ...model, rightPanelTab: tab };
    render(`${idPrefix}-right-tab-${tab}`);
    options.onRightPanelChange?.(tab);
  };

  const selectAssistantMode = (mode: StudioAssistantMode): void => {
    assistantMode = mode;
    render(`${idPrefix}-assistant-mode-${mode}`);
  };

  const selectBottomTab = (tab: StudioBottomPanelTab): void => {
    model = { ...model, bottomPanelTab: tab };
    render(`${idPrefix}-bottom-tab-${tab}`);
    options.onBottomPanelChange?.(tab);
  };

  const selectMobileView = (view: StudioMobileView): void => {
    model = { ...model, mobileView: view };
    render(`${idPrefix}-mobile-${view}`);
    options.onMobileViewChange?.(view);
  };

  const selectLayoutPreference = (
    preference: StudioLayoutPreference,
  ): void => {
    model = { ...model, layoutPreference: preference };
    render(`${idPrefix}-layout-preference`);
    options.onLayoutPreferenceChange?.(preference);
  };

  const selectProjectFile = (path: string): void => {
    projectFilesPane = "viewer";
    void options.onSelectProjectFile?.(path);
    render();
  };

  const showProjectFileTree = (): void => {
    projectFilesPane = "tree";
    render(`${idPrefix}-project-file-search`);
  };

  const closeProjectFile = (): void => {
    projectFilesPane = "tree";
    options.onCloseProjectFile?.();
  };

  const refreshResolvedLayout = (): void => {
    root.dataset.layoutPreference = model.layoutPreference;
    root.dataset.layout = resolveStudioLayout(
      model.layoutPreference,
      readLayoutSignals(container, document),
    );
  };

  const render = (focusId?: string): void => {
    if (destroyed) {
      return;
    }

    root.setAttribute(
      "aria-label",
      `Estúdio colaborativo do projeto ${model.projectName}`,
    );
    root.dataset.mobileView = model.mobileView;
    root.dataset.projectFilesPane = projectFilesPane;
    root.dataset.projectFileSelected = String(
      model.projectFiles.selectedPath !== null,
    );
    refreshResolvedLayout();
    root.replaceChildren(
      createHeader(
        document,
        idPrefix,
        model,
        selectLayoutPreference,
        options,
      ),
      createOverview(document, idPrefix, model),
      createMainLayout(
        document,
        idPrefix,
        model,
        options,
        drafts,
        assistantMode,
        selectAssistantMode,
        sandboxPreviewHost,
        selectProposal,
        selectComparison,
        selectRightTab,
        projectFileSearch,
        (value) => {
          projectFileSearch = value;
        },
        selectProjectFile,
        showProjectFileTree,
        closeProjectFile,
      ),
      createBottomPanel(
        document,
        idPrefix,
        model,
        selectBottomTab,
      ),
      createMobileNavigation(
        document,
        idPrefix,
        model.mobileView,
        selectMobileView,
      ),
    );

    if (focusId) {
      document.getElementById(focusId)?.focus();
    }
  };

  container.replaceChildren(root);
  render();
  const stopObservingLayout = observeLayoutChanges(
    container,
    document,
    refreshResolvedLayout,
  );

  return {
    sandboxPreviewHost,
    update(nextModel) {
      if (destroyed) {
        return;
      }
      model = nextModel;
      render();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stopObservingLayout();
      root.remove();
    },
  };
}

function createHeader(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  onLayoutPreferenceChange: (preference: StudioLayoutPreference) => void,
  options: StudioShellOptions,
): HTMLElement {
  const header = element(document, "header", "studio-header");
  const brand = element(document, "div", "studio-brand");
  const mark = element(document, "span", "studio-brand__mark", "◆");
  mark.setAttribute("aria-hidden", "true");
  const titles = element(document, "div");
  titles.append(
    element(document, "span", "studio-eyebrow", "Estúdio compartilhado"),
    element(document, "h1", undefined, model.projectName),
  );
  brand.append(mark, titles);

  const connectionMeta = CONNECTION[model.connectionState];
  const connection = element(
    document,
    "span",
    "studio-status-chip",
    connectionMeta.label,
  );
  connection.dataset.tone = connectionMeta.tone;
  connection.setAttribute("role", "status");
  connection.setAttribute("aria-live", "polite");
  const actions = element(document, "div", "studio-header__actions");
  if (options.onExitStudio) {
    const exit = element(document, "button", "studio-exit-button", "Voltar ao editor");
    exit.type = "button";
    exit.addEventListener("click", options.onExitStudio);
    actions.append(exit);
  }
  if (options.onLogout) {
    const logout = element(
      document,
      "button",
      "studio-logout-button",
      "Encerrar sessão",
    );
    logout.type = "button";
    logout.addEventListener("click", () => void options.onLogout?.());
    actions.append(logout);
  }
  actions.append(
    connection,
    createLayoutPreferenceSelector(
      document,
      idPrefix,
      model.layoutPreference,
      onLayoutPreferenceChange,
    ),
  );
  header.append(brand, actions);
  return header;
}

function createLayoutPreferenceSelector(
  document: Document,
  idPrefix: string,
  preference: StudioLayoutPreference,
  onChange: (preference: StudioLayoutPreference) => void,
): HTMLElement {
  const wrapper = element(document, "label", "studio-layout-selector");
  const text = element(document, "span", "studio-sr-only", "Modo de layout");
  const select = document.createElement("select");
  select.id = `${idPrefix}-layout-preference`;
  select.setAttribute("aria-label", "Modo de layout");
  for (const optionModel of [
    { value: "auto", label: "Layout automático" },
    { value: "desktop", label: "Layout desktop" },
    { value: "mobile", label: "Layout celular" },
  ] as const) {
    const option = document.createElement("option");
    option.value = optionModel.value;
    option.textContent = optionModel.label;
    option.selected = optionModel.value === preference;
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (
      select.value === "auto" ||
      select.value === "desktop" ||
      select.value === "mobile"
    ) {
      onChange(select.value);
    }
  });
  wrapper.append(text, select);
  return wrapper;
}

function createOverview(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
): HTMLElement {
  const overview = element(document, "section", "studio-overview");
  overview.setAttribute("aria-labelledby", `${idPrefix}-overview-title`);
  const heading = element(document, "div", "studio-section-heading");
  const title = element(document, "h2", undefined, "Visão geral");
  title.id = `${idPrefix}-overview-title`;
  const subtitle = element(
    document,
    "p",
    undefined,
    "O jogo publicado permanece separado das propostas em andamento.",
  );
  heading.append(title, subtitle);

  const stats = element(document, "dl", "studio-overview__stats");
  appendStat(document, stats, "Versão publicada", model.publishedVersion);
  appendStat(document, stats, "Último deploy", model.deploymentLabel);
  appendStat(
    document,
    stats,
    "Propostas ativas",
    String(
      model.proposals.filter(
        ({ status }) => !["published", "rejected"].includes(status),
      ).length,
    ),
  );
  appendStat(
    document,
    stats,
    "Pessoas online",
    String(model.members.filter(({ presence }) => presence === "online").length),
  );
  overview.append(heading, stats);
  return overview;
}

function createMainLayout(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  drafts: StudioComposerDrafts,
  assistantMode: StudioAssistantMode,
  onAssistantModeChange: (mode: StudioAssistantMode) => void,
  sandboxPreviewHost: HTMLElement,
  onSelectProposal: (proposalId: string) => void,
  onComparisonChange: (target: StudioComparisonTarget) => void,
  onRightPanelChange: (tab: StudioRightPanelTab) => void,
  projectFileSearch: string,
  onProjectFileSearchChange: (value: string) => void,
  onSelectProjectFile: (path: string) => void,
  onShowProjectFileTree: () => void,
  onCloseProjectFile: () => void,
): HTMLElement {
  const main = element(document, "main", "studio-main");
  main.append(
    createSidebar(
      document,
      idPrefix,
      model,
      options,
      onSelectProposal,
      projectFileSearch,
      onProjectFileSearchChange,
      onSelectProjectFile,
    ),
    createWorkspace(
      document,
      idPrefix,
      model,
      options,
      sandboxPreviewHost,
      onComparisonChange,
      onShowProjectFileTree,
      onCloseProjectFile,
    ),
    createRightPanel(
      document,
      idPrefix,
      model,
      options,
      drafts,
      assistantMode,
      onAssistantModeChange,
      onRightPanelChange,
    ),
  );
  return main;
}

function createSidebar(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  onSelectProposal: (proposalId: string) => void,
  projectFileSearch: string,
  onProjectFileSearchChange: (value: string) => void,
  onSelectProjectFile: (path: string) => void,
): HTMLElement {
  const sidebar = element(document, "aside", "studio-sidebar");
  sidebar.setAttribute("aria-label", "Pessoas e propostas do projeto");

  const presenceSection = element(document, "section", "studio-panel-section");
  presenceSection.append(
    element(document, "h2", undefined, "No Estúdio"),
    createPresenceList(document, model),
    createInvitePanel(document, model, options),
  );

  const proposalsSection = element(document, "section", "studio-panel-section");
  const proposalHeading = element(document, "div", "studio-section-heading--row");
  proposalHeading.append(
    element(document, "h2", undefined, "Propostas"),
    element(document, "span", "studio-count", String(model.proposals.length)),
  );
  proposalsSection.append(
    proposalHeading,
    createProposalList(document, model, onSelectProposal),
  );

  sidebar.append(
    presenceSection,
    proposalsSection,
    createProjectFilesSection(
      document,
      idPrefix,
      model,
      projectFileSearch,
      onProjectFileSearchChange,
      onSelectProjectFile,
    ),
  );
  return sidebar;
}

function createProjectFilesSection(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  currentSearch: string,
  onSearchChange: (value: string) => void,
  onSelectFile: (path: string) => void,
): HTMLElement {
  const section = element(document, "section", "studio-panel-section studio-project-files");
  const visibleFiles = model.projectFiles.files.filter(({ path }) =>
    isProjectFileVisibleInShell(path),
  );
  const heading = element(document, "div", "studio-section-heading--row");
  heading.append(
    element(document, "h2", undefined, "Arquivos do projeto"),
    element(document, "span", "studio-count", String(visibleFiles.length)),
  );
  section.append(heading);

  const status = element(
    document,
    "p",
    "studio-project-files__status",
    model.projectFiles.statusMessage,
  );
  status.setAttribute(
    "role",
    model.projectFiles.state === "error" ? "alert" : "status",
  );
  section.append(status);

  if (model.projectFiles.state === "loading") {
    section.setAttribute("aria-busy", "true");
    return section;
  }
  if (model.projectFiles.state === "error" || visibleFiles.length === 0) {
    section.append(
      element(
        document,
        "p",
        "studio-empty",
        model.projectFiles.state === "error"
          ? "O restante do Estúdio continua disponível."
          : "Nenhum arquivo público foi disponibilizado.",
      ),
    );
    return section;
  }

  const searchLabel = element(
    document,
    "label",
    "studio-sr-only",
    "Buscar arquivos do projeto",
  );
  const search = document.createElement("input");
  search.id = `${idPrefix}-project-file-search`;
  search.className = "studio-project-files__search";
  search.type = "search";
  search.value = currentSearch;
  search.placeholder = "Buscar por nome ou caminho…";
  search.setAttribute("aria-label", "Buscar arquivos do projeto");
  searchLabel.htmlFor = search.id;

  const resultStatus = element(document, "p", "studio-project-files__result-status");
  resultStatus.setAttribute("role", "status");
  resultStatus.setAttribute("aria-live", "polite");
  const groups = element(document, "div", "studio-project-files__groups");
  const groupViews: {
    readonly section: HTMLElement;
    readonly entries: readonly {
      readonly entry: ProjectFileEntry;
      readonly button: HTMLButtonElement;
    }[];
  }[] = [];

  for (const category of PROJECT_FILE_CATEGORIES) {
    const categoryFiles = visibleFiles.filter(
      (entry) => entry.category === category.id,
    );
    if (categoryFiles.length === 0) {
      continue;
    }
    const group = element(document, "section", "studio-project-file-group");
    const title = element(document, "h3", undefined, category.label);
    const list = element(document, "div", "studio-project-file-list");
    const entryViews = categoryFiles.map((entry) => {
      const fileButton = element(
        document,
        "button",
        "studio-project-file",
      );
      fileButton.type = "button";
      fileButton.dataset.projectFilePath = entry.path;
      fileButton.setAttribute(
        "aria-pressed",
        String(entry.path === model.projectFiles.selectedPath),
      );
      const parentPath = projectFileParentPath(entry.path);
      fileButton.append(
        element(document, "strong", undefined, entry.name),
        element(
          document,
          "small",
          undefined,
          `${parentPath ? `${parentPath} · ` : ""}${formatFileSize(entry.sizeBytes)}`,
        ),
      );
      fileButton.addEventListener("click", () => onSelectFile(entry.path));
      list.append(fileButton);
      return { entry, button: fileButton };
    });
    group.append(title, list);
    groups.append(group);
    groupViews.push({ section: group, entries: entryViews });
  }

  const noResults = element(
    document,
    "p",
    "studio-empty studio-project-files__no-results",
    "Nenhum arquivo corresponde à busca.",
  );
  const applySearch = (): void => {
    const query = search.value;
    onSearchChange(query);
    let visibleCount = 0;
    for (const group of groupViews) {
      let visibleInGroup = 0;
      for (const item of group.entries) {
        const matches = projectFileMatchesSearch(item.entry, query);
        item.button.hidden = !matches;
        if (matches) {
          visibleCount += 1;
          visibleInGroup += 1;
        }
      }
      group.section.hidden = visibleInGroup === 0;
    }
    noResults.hidden = visibleCount > 0;
    resultStatus.textContent = `${visibleCount} ${plural(
      visibleCount,
      "arquivo encontrado",
      "arquivos encontrados",
    )}.`;
  };
  search.addEventListener("input", applySearch);
  section.append(searchLabel, search, resultStatus, groups, noResults);
  applySearch();
  return section;
}

export function projectFileMatchesSearch(
  entry: Pick<ProjectFileEntry, "name" | "path">,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalizedQuery) {
    return true;
  }
  return `${entry.name}\n${entry.path}`
    .toLocaleLowerCase("pt-BR")
    .includes(normalizedQuery);
}

function createPresenceList(
  document: Document,
  model: StudioShellModel,
): HTMLElement {
  const list = element(document, "ul", "studio-presence-list");
  list.setAttribute("aria-label", "Presença da equipe");
  for (const member of model.members) {
    const item = element(document, "li", "studio-presence");
    const avatar = element(document, "span", "studio-avatar", member.initials);
    avatar.dataset.presence = member.presence;
    avatar.setAttribute("aria-hidden", "true");
    const content = element(document, "span", "studio-presence__content");
    const name = element(document, "strong", undefined, member.displayName);
    const context = element(
      document,
      "small",
      undefined,
      member.currentContext ?? presenceLabel(member.presence),
    );
    content.append(name, context);
    const accessibleState = element(
      document,
      "span",
      "studio-sr-only",
      `, ${presenceLabel(member.presence)}`,
    );
    item.append(avatar, content, accessibleState);
    list.append(item);
  }
  return list;
}

function createInvitePanel(
  document: Document,
  model: StudioShellModel,
  options: StudioShellOptions,
): HTMLElement {
  const panel = element(document, "section", "studio-invite-panel");
  panel.dataset.inviteState = model.invite.state;
  if (model.role !== "owner") {
    panel.hidden = true;
    return panel;
  }
  const status = element(
    document,
    "p",
    "studio-invite-panel__status",
    model.invite.statusMessage,
  );
  status.setAttribute(
    "role",
    model.invite.state === "error" ? "alert" : "status",
  );
  panel.append(status);
  if (model.invite.state !== "ready") {
    const create = element(
      document,
      "button",
      "studio-invite-panel__create",
      model.invite.state === "creating" ? "Criando convite…" : "Convidar amigo",
    );
    create.type = "button";
    create.disabled = model.invite.state === "creating";
    create.addEventListener("click", () => void options.onCreateInvite?.());
    panel.append(create);
  }
  if (model.invite.state === "ready" && model.invite.shareUrl) {
    if (model.invite.expiresAtLabel) {
      panel.append(
        element(
          document,
          "small",
          undefined,
          `Convite válido até ${model.invite.expiresAtLabel}.`,
        ),
      );
    }
    const actions = element(document, "div", "studio-invite-panel__actions");
    const copy = element(document, "button", undefined, "Copiar link");
    copy.type = "button";
    copy.addEventListener("click", () => void options.onCopyInviteLink?.());
    const share = element(document, "button", undefined, "Compartilhar");
    share.type = "button";
    share.addEventListener("click", () => void options.onShareInviteLink?.());
    actions.append(copy, share);
    panel.append(actions);
  }
  return panel;
}

function createProposalList(
  document: Document,
  model: StudioShellModel,
  onSelectProposal: (proposalId: string) => void,
): HTMLElement {
  const list = element(document, "div", "studio-proposal-list");
  if (model.proposals.length === 0) {
    list.append(
      element(
        document,
        "p",
        "studio-empty",
        "Nenhuma proposta. O jogo publicado continua intacto.",
      ),
    );
    return list;
  }

  for (const proposal of model.proposals) {
    const card = element(document, "article", "studio-proposal-card");
    const button = element(document, "button", "studio-proposal-card__button");
    button.type = "button";
    button.dataset.proposalId = proposal.id;
    const selected = proposal.id === model.selectedProposalId;
    button.setAttribute("aria-pressed", String(selected));
    if (selected) {
      card.dataset.selected = "true";
    }

    const top = element(document, "span", "studio-proposal-card__top");
    top.append(
      element(document, "strong", undefined, proposal.title),
      createProposalStatus(document, proposal.status),
    );
    const summary = element(
      document,
      "span",
      "studio-proposal-card__summary",
      proposal.summary,
    );
    const metadata = element(
      document,
      "span",
      "studio-proposal-card__meta",
      `${proposal.authorName} · ${proposal.updatedAtLabel} · ${proposal.changeCount} ${plural(
        proposal.changeCount,
        "alteração",
        "alterações",
      )}`,
    );
    if (proposal.problemCount > 0) {
      metadata.append(
        ` · ${proposal.problemCount} ${plural(
          proposal.problemCount,
          "problema",
          "problemas",
        )}`,
      );
    }
    button.append(top, summary, metadata);
    button.addEventListener("click", () => {
      onSelectProposal(proposal.id);
    });
    card.append(button);
    list.append(card);
  }
  return list;
}

function createWorkspace(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  sandboxPreviewHost: HTMLElement,
  onComparisonChange: (target: StudioComparisonTarget) => void,
  onShowProjectFileTree: () => void,
  onCloseProjectFile: () => void,
): HTMLElement {
  const workspace = element(document, "section", "studio-workspace");
  workspace.setAttribute("aria-label", "Área de trabalho do Estúdio");
  workspace.dataset.projectFileOpen = String(
    model.projectFiles.selectedPath !== null,
  );
  const selected = selectedProposal(model);
  const comparisonTarget = selected ? model.comparisonTarget : "current";
  const heading = element(document, "div", "studio-workspace__heading");
  const headingText = element(document, "div");
  const title = element(document, "h2", undefined, "Sandbox de prévia");
  title.id = `${idPrefix}-workspace-title`;
  headingText.append(
    title,
    element(
      document,
      "p",
      undefined,
      selected
        ? `Comparando o jogo publicado com “${selected.title}”.`
        : "Selecione uma proposta para preparar uma versão candidata.",
    ),
  );
  heading.append(
    headingText,
    createComparisonSelector(
      document,
      idPrefix,
      model,
      selected?.title ?? null,
      comparisonTarget,
      onComparisonChange,
    ),
  );

  const preview = createSandboxPreviewSurface(
    document,
    idPrefix,
    model,
    comparisonTarget,
    selected?.title ?? null,
    sandboxPreviewHost,
  );
  const testEvidence = createSandboxTestEvidence(
    document,
    idPrefix,
    model,
    comparisonTarget,
    options,
  );
  const approval = createApprovalArea(document, idPrefix, model, options);
  const sandboxWorkspace = element(
    document,
    "div",
    "studio-sandbox-workspace",
  );
  sandboxWorkspace.append(heading, preview, testEvidence, approval);
  workspace.append(sandboxWorkspace);
  if (model.projectFiles.selectedPath) {
    workspace.append(
      createProjectFileViewer(
        document,
        idPrefix,
        model,
        onShowProjectFileTree,
        onCloseProjectFile,
      ),
    );
  }
  return workspace;
}

function createProjectFileViewer(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  onShowProjectFileTree: () => void,
  onCloseProjectFile: () => void,
): HTMLElement {
  const selectedPath = model.projectFiles.selectedPath;
  const manifestEntry = model.projectFiles.files.find(
    ({ path }) => path === selectedPath,
  );
  const viewer = element(document, "section", "studio-project-file-viewer");
  viewer.setAttribute("aria-labelledby", `${idPrefix}-project-file-title`);

  const toolbar = element(document, "div", "studio-project-file-viewer__toolbar");
  const backToTree = element(
    document,
    "button",
    "studio-project-file-viewer__back",
    "← Voltar aos arquivos",
  );
  backToTree.type = "button";
  backToTree.addEventListener("click", onShowProjectFileTree);
  const close = element(
    document,
    "button",
    "studio-project-file-viewer__close",
    "Voltar ao sandbox",
  );
  close.type = "button";
  close.addEventListener("click", onCloseProjectFile);
  toolbar.append(backToTree, close);

  const heading = element(document, "div", "studio-project-file-viewer__heading");
  const title = element(
    document,
    "h2",
    undefined,
    manifestEntry?.name ?? "Arquivo do projeto",
  );
  title.id = `${idPrefix}-project-file-title`;
  heading.append(
    title,
    element(
      document,
      "p",
      undefined,
      "Somente leitura. Para mudar este arquivo, descreva a alteração e transforme-a em uma proposta testável.",
    ),
  );
  viewer.append(toolbar, heading);

  if (!manifestEntry || !selectedPath || !isProjectFileVisibleInShell(selectedPath)) {
    const invalid = element(
      document,
      "p",
      "studio-project-file-viewer__message",
      "O arquivo selecionado não está mais disponível.",
    );
    invalid.setAttribute("role", "alert");
    viewer.append(invalid);
    return viewer;
  }

  const metadata = element(document, "dl", "studio-project-file-viewer__metadata");
  appendProjectFileMetadata(document, metadata, "Caminho", manifestEntry.path);
  appendProjectFileMetadata(
    document,
    metadata,
    "Tamanho",
    formatFileSize(manifestEntry.sizeBytes),
  );
  appendProjectFileMetadata(document, metadata, "Tipo", manifestEntry.mediaType);
  appendProjectFileMetadata(document, metadata, "SHA-256", manifestEntry.sha256);
  viewer.append(metadata);

  if (model.projectFiles.contentState === "loading") {
    const loading = element(
      document,
      "p",
      "studio-project-file-viewer__message",
      model.projectFiles.contentMessage,
    );
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-busy", "true");
    viewer.append(loading);
    return viewer;
  }
  if (model.projectFiles.contentState === "error") {
    const error = element(
      document,
      "p",
      "studio-project-file-viewer__message",
      model.projectFiles.contentMessage,
    );
    error.setAttribute("role", "alert");
    viewer.append(error);
    return viewer;
  }

  const file = model.projectFiles.selectedContent;
  if (
    model.projectFiles.contentState !== "ready" ||
    !file ||
    file.entry.path !== selectedPath ||
    file.entry.sha256 !== manifestEntry.sha256
  ) {
    viewer.append(
      element(
        document,
        "p",
        "studio-project-file-viewer__message",
        model.projectFiles.contentMessage,
      ),
    );
    return viewer;
  }

  if (file.entry.kind === "image") {
    viewer.append(createProjectImagePreview(document, file));
  } else {
    viewer.append(createProjectTextPreview(document, file));
  }
  return viewer;
}

function createProjectImagePreview(
  document: Document,
  file: NonNullable<StudioShellModel["projectFiles"]["selectedContent"]>,
): HTMLElement {
  const preview = element(document, "figure", "studio-project-file-image");
  if (
    file.encoding !== "base64" ||
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      file.entry.mediaType,
    )
  ) {
    const error = element(
      document,
      "p",
      "studio-project-file-viewer__message",
      "Este formato de imagem não pode ser exibido com segurança.",
    );
    error.setAttribute("role", "alert");
    preview.append(error);
    return preview;
  }
  const image = document.createElement("img");
  image.src = `data:${file.entry.mediaType};base64,${file.content}`;
  image.alt = `Prévia de ${file.entry.name}`;
  image.loading = "lazy";
  image.decoding = "async";
  preview.append(
    image,
    element(
      document,
      "figcaption",
      undefined,
      `${file.entry.name} · pixels preservados sem suavização`,
    ),
  );
  return preview;
}

function createProjectTextPreview(
  document: Document,
  file: NonNullable<StudioShellModel["projectFiles"]["selectedContent"]>,
): HTMLElement {
  const wrapper = element(document, "div", "studio-project-file-text");
  if (file.encoding !== "utf8") {
    const error = element(
      document,
      "p",
      "studio-project-file-viewer__message",
      "O servidor não retornou este texto em UTF-8.",
    );
    error.setAttribute("role", "alert");
    wrapper.append(error);
    return wrapper;
  }

  const formatted = formatProjectFileText(file.entry.path, file.content);
  const characterLimited = formatted.slice(0, MAX_RENDERED_TEXT_CHARACTERS);
  const allLines = characterLimited.split(/\r?\n/);
  const displayedLines = allLines.slice(0, MAX_RENDERED_FILE_LINES);
  const truncated =
    formatted.length > characterLimited.length ||
    allLines.length > displayedLines.length;
  const lines = element(document, "ol", "studio-project-file-lines");
  lines.setAttribute("aria-label", `Conteúdo somente leitura de ${file.entry.path}`);
  const markdown = /\.(?:md|mdx)$/i.test(file.entry.path);
  if (markdown) {
    lines.dataset.format = "markdown";
  }
  for (const [index, sourceLine] of displayedLines.entries()) {
    const line = element(document, "li", "studio-project-file-line");
    line.dataset.line = String(index + 1);
    if (markdown) {
      line.dataset.markdownKind = markdownLineKind(sourceLine);
    }
    line.append(element(document, "code", undefined, sourceLine || " "));
    lines.append(line);
  }
  wrapper.append(lines);
  if (truncated) {
    wrapper.prepend(
      element(
        document,
        "p",
        "studio-project-file-viewer__notice",
        "A prévia foi limitada para manter o Estúdio rápido neste dispositivo; o arquivo original não foi alterado.",
      ),
    );
  }
  return wrapper;
}

function createComparisonSelector(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  candidateTitle: string | null,
  comparisonTarget: StudioComparisonTarget,
  onComparisonChange: (target: StudioComparisonTarget) => void,
): HTMLElement {
  const fieldset = element(document, "fieldset", "studio-comparison");
  fieldset.append(element(document, "legend", "studio-sr-only", "Versão da prévia"));
  fieldset.append(
    comparisonOption(
      document,
      `${idPrefix}-comparison-current`,
      "current",
      "Jogo atual",
      model.publishedVersion,
      comparisonTarget === "current",
      false,
      onComparisonChange,
    ),
    comparisonOption(
      document,
      `${idPrefix}-comparison-candidate`,
      "candidate",
      "Candidata",
      candidateTitle ?? "Nenhuma proposta selecionada",
      comparisonTarget === "candidate",
      candidateTitle === null,
      onComparisonChange,
    ),
  );
  return fieldset;
}

function createSandboxPreviewSurface(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  comparisonTarget: StudioComparisonTarget,
  candidateTitle: string | null,
  sandboxPreviewHost: HTMLElement,
): HTMLElement {
  const isCandidate = comparisonTarget === "candidate";
  const displayedPreviewState = isCandidate
    ? model.sandbox.previewState
    : "ready";
  const displayedStatusMessage = isCandidate
    ? model.sandbox.statusMessage
    : `A versão publicada ${model.publishedVersion} está pronta para jogar.`;
  const previewState = SANDBOX_PREVIEW_STATE[displayedPreviewState];
  const preview = element(document, "section", "studio-preview");
  preview.dataset.studioPreviewSlot = comparisonTarget;
  preview.dataset.previewState = displayedPreviewState;
  preview.setAttribute("role", "region");
  preview.setAttribute(
    "aria-label",
    isCandidate
      ? `Jogo executável da proposta ${candidateTitle ?? "não selecionada"}`
      : `Jogo executável da versão atual ${model.publishedVersion}`,
  );

  const toolbar = element(document, "div", "studio-preview__toolbar");
  const identity = element(document, "div", "studio-preview__identity");
  const revisionBadge = element(
    document,
    "span",
    "studio-preview__revision-badge",
    isCandidate ? "CANDIDATA" : "ATUAL",
  );
  revisionBadge.dataset.target = comparisonTarget;
  identity.append(
    revisionBadge,
    element(
      document,
      "strong",
      undefined,
      isCandidate
        ? candidateTitle ?? "Candidata indisponível"
        : model.publishedVersion,
    ),
  );

  const status = element(document, "span", "studio-preview__status");
  status.id = `${idPrefix}-sandbox-status`;
  status.dataset.tone = previewState.tone;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.append(
    element(
      document,
      "span",
      "studio-preview__status-icon",
      previewState.icon,
    ),
    element(document, "span", undefined, previewState.label),
  );
  toolbar.append(identity, status);

  const viewport = element(document, "div", "studio-preview__viewport");
  sandboxPreviewHost.setAttribute(
    "aria-label",
    isCandidate ? "Jogar versão candidata" : "Jogar versão atual",
  );
  viewport.append(sandboxPreviewHost);

  if (
    displayedPreviewState === "preparing" ||
    displayedPreviewState === "failed"
  ) {
    const notice = element(document, "div", "studio-preview__notice");
    notice.dataset.tone = previewState.tone;
    notice.append(
      element(document, "strong", undefined, previewState.label),
      element(document, "p", undefined, displayedStatusMessage),
    );
    viewport.append(notice);
  }

  const description = element(
    document,
    "p",
    "studio-preview__description",
    displayedStatusMessage,
  );
  preview.append(toolbar, viewport, description);
  return preview;
}

function createSandboxTestEvidence(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  comparisonTarget: StudioComparisonTarget,
  options: StudioShellOptions,
): HTMLElement {
  const selected = selectedProposal(model);
  const candidateRevisionId = model.approval.candidateRevisionId;
  const isCandidate = comparisonTarget === "candidate";
  const isBusy =
    model.sandbox.previewState === "preparing" ||
    model.sandbox.previewState === "testing";
  const canRunTest = Boolean(
    isCandidate &&
      selected &&
      candidateRevisionId &&
      model.sandbox.canRunTest &&
      !isBusy,
  );

  const section = element(document, "section", "studio-sandbox-test");
  section.setAttribute("aria-labelledby", `${idPrefix}-sandbox-test-title`);
  const heading = element(document, "div", "studio-sandbox-test__heading");
  const headingText = element(document, "div");
  const title = element(document, "h3", undefined, "Teste desta revisão");
  title.id = `${idPrefix}-sandbox-test-title`;
  headingText.append(
    title,
    element(
      document,
      "p",
      undefined,
      isCandidate
        ? "Jogue no preview e registre as evidências antes de aprovar."
        : "Abra a candidata para executar e registrar um teste.",
    ),
  );

  const runTest = element(
    document,
    "button",
    "studio-sandbox-test__button",
    model.sandbox.previewState === "testing"
      ? "Testando…"
      : model.sandbox.previewState === "failed"
        ? "Registrar falha do teste"
        : "Executar e registrar teste",
  );
  runTest.type = "button";
  runTest.disabled = !canRunTest;
  runTest.dataset.testid = "studio-run-sandbox-test";
  runTest.setAttribute("aria-describedby", `${idPrefix}-sandbox-status`);
  runTest.addEventListener("click", () => {
    if (!canRunTest || !selected || !candidateRevisionId) {
      return;
    }
    void options.onRunSandboxTest?.({
      workspaceId: model.workspaceId,
      proposalId: selected.id,
      revisionId: candidateRevisionId,
    });
  });
  heading.append(headingText, runTest);

  const checklist = element(document, "ul", "studio-sandbox-checklist");
  checklist.setAttribute("aria-label", "Evidências do teste da candidata");
  if (model.sandbox.checklist.length === 0) {
    checklist.append(
      element(
        document,
        "li",
        "studio-sandbox-checklist__empty",
        "Nenhuma evidência registrada para esta revisão.",
      ),
    );
  } else {
    for (const check of model.sandbox.checklist) {
      const metadata = SANDBOX_CHECK_STATUS[check.status];
      const item = element(document, "li", "studio-sandbox-checklist__item");
      item.dataset.status = check.status;
      const icon = element(
        document,
        "span",
        "studio-sandbox-checklist__icon",
        metadata.icon,
      );
      icon.setAttribute("aria-hidden", "true");
      const content = element(
        document,
        "span",
        "studio-sandbox-checklist__content",
      );
      content.append(
        element(document, "strong", undefined, check.label),
        element(
          document,
          "small",
          undefined,
          check.detail ?? metadata.label,
        ),
      );
      const accessibleStatus = element(
        document,
        "span",
        "studio-sr-only",
        `: ${metadata.label}`,
      );
      item.append(icon, content, accessibleStatus);
      checklist.append(item);
    }
  }

  section.append(heading, checklist);
  return section;
}

function createMobileNavigation(
  document: Document,
  idPrefix: string,
  activeView: StudioMobileView,
  onChange: (view: StudioMobileView) => void,
): HTMLElement {
  const navigation = element(document, "nav", "studio-mobile-nav");
  navigation.setAttribute("aria-label", "Navegação móvel do Estúdio");
  for (const view of MOBILE_VIEWS) {
    const button = element(document, "button", "studio-mobile-nav__button");
    button.id = `${idPrefix}-mobile-${view.id}`;
    button.type = "button";
    button.dataset.mobileView = view.id;
    if (view.id === activeView) {
      button.setAttribute("aria-current", "page");
    }
    const icon = element(document, "span", "studio-mobile-nav__icon", view.icon);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, element(document, "span", undefined, view.label));
    button.addEventListener("click", () => {
      onChange(view.id);
    });
    navigation.append(button);
  }
  return navigation;
}

function comparisonOption(
  document: Document,
  id: string,
  value: StudioComparisonTarget,
  label: string,
  detail: string,
  checked: boolean,
  disabled: boolean,
  onChange: (target: StudioComparisonTarget) => void,
): HTMLElement {
  const wrapper = element(document, "label", "studio-comparison__option");
  const input = document.createElement("input");
  input.id = id;
  input.type = "radio";
  input.name = `${id.slice(0, id.lastIndexOf("-"))}-target`;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => {
    if (input.checked) {
      onChange(value);
    }
  });
  const visibleLabel = element(document, "span");
  visibleLabel.append(
    element(document, "strong", undefined, label),
    element(document, "small", undefined, detail),
  );
  wrapper.append(input, visibleLabel);
  return wrapper;
}

function createApprovalArea(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
): HTMLElement {
  const area = element(document, "footer", "studio-approval");
  const state = deriveApprovalControl(model);
  const reason = element(document, "p", "studio-approval__reason", state.reason);
  reason.id = `${idPrefix}-approval-reason`;
  reason.setAttribute("aria-live", "polite");
  area.append(reason);

  if (!state.visible) {
    const ownerOnly = element(document, "span", "studio-owner-only", "Aprovação do dono");
    ownerOnly.setAttribute("aria-label", state.reason);
    area.append(ownerOnly);
    return area;
  }

  const button = element(document, "button", "studio-approve-button", state.label);
  button.type = "button";
  button.disabled = state.disabled;
  button.dataset.testid = "studio-approve";
  button.setAttribute("aria-describedby", reason.id);
  button.addEventListener("click", () => {
    const selected = selectedProposal(model);
    const revisionId = model.approval.candidateRevisionId;
    if (state.disabled || !selected || !revisionId) {
      return;
    }
    void options.onApprove?.({
      workspaceId: model.workspaceId,
      proposalId: selected.id,
      revisionId,
    });
  });
  area.append(button);
  return area;
}

function createRightPanel(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  drafts: StudioComposerDrafts,
  assistantMode: StudioAssistantMode,
  onAssistantModeChange: (mode: StudioAssistantMode) => void,
  onTabChange: (tab: StudioRightPanelTab) => void,
): HTMLElement {
  const panel = element(document, "aside", "studio-right-panel");
  panel.setAttribute("aria-label", "Ferramentas contextuais");
  const tabList = createTabList(
    document,
    `${idPrefix}-right`,
    "Ferramentas do Estúdio",
    RIGHT_TABS,
    model.rightPanelTab,
    onTabChange,
  );
  panel.append(tabList);

  for (const tab of RIGHT_TABS) {
    const tabPanel = element(document, "section", "studio-tab-panel");
    tabPanel.id = `${idPrefix}-right-panel-${tab.id}`;
    tabPanel.setAttribute("role", "tabpanel");
    tabPanel.setAttribute("aria-labelledby", `${idPrefix}-right-tab-${tab.id}`);
    tabPanel.hidden = tab.id !== model.rightPanelTab;
    if (tab.id === "inspector") {
      tabPanel.append(createInspector(document, model));
    } else if (tab.id === "chat") {
      tabPanel.append(createChat(document, idPrefix, model, options, drafts));
    } else {
      tabPanel.append(
        createAssistant(
          document,
          idPrefix,
          model,
          options,
          drafts,
          assistantMode,
          onAssistantModeChange,
        ),
      );
    }
    panel.append(tabPanel);
  }
  return panel;
}

function createInspector(
  document: Document,
  model: StudioShellModel,
): HTMLElement {
  const inspector = element(document, "div", "studio-inspector");
  inspector.append(
    element(document, "h2", undefined, model.inspector.selectionLabel),
    element(document, "p", undefined, model.inspector.description),
  );
  const fields = element(document, "dl", "studio-inspector__fields");
  for (const field of model.inspector.fields) {
    const wrapper = element(document, "div", "studio-inspector__field");
    wrapper.dataset.fieldId = field.id;
    wrapper.append(
      element(document, "dt", undefined, field.label),
      element(document, "dd", undefined, field.value),
    );
    fields.append(wrapper);
  }
  if (model.inspector.fields.length === 0) {
    fields.append(
      element(document, "p", "studio-empty", "Selecione um objeto do projeto."),
    );
  }
  inspector.append(fields);
  return inspector;
}

function createChat(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  drafts: StudioComposerDrafts,
): HTMLElement {
  const chat = element(document, "div", "studio-conversation");
  chat.append(
    element(document, "h2", undefined, model.chat.channelLabel),
    createMessageLog(document, model),
  );
  const form = element(document, "form", "studio-composer") as HTMLFormElement;
  const label = element(document, "label", "studio-sr-only", "Mensagem para a equipe");
  const input = document.createElement("textarea");
  input.rows = 2;
  input.value = drafts.chat;
  input.placeholder = "Escreva uma mensagem ou registre uma decisão…";
  input.disabled = !model.chat.canPost;
  label.htmlFor = `${idPrefix}-chat-message`;
  input.id = label.htmlFor;
  input.addEventListener("input", () => {
    drafts.chat = input.value;
  });
  const button = element(document, "button", undefined, "Enviar");
  button.type = "submit";
  button.disabled = !model.chat.canPost;
  form.append(label, input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || !model.chat.canPost) {
      return;
    }
    input.value = "";
    drafts.chat = "";
    void options.onSendChat?.(model.chat.channelId, message);
  });
  chat.append(form);
  return chat;
}

function createMessageLog(
  document: Document,
  model: StudioShellModel,
): HTMLElement {
  const log = element(document, "div", "studio-message-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", `Mensagens em ${model.chat.channelLabel}`);
  if (model.chat.messages.length === 0) {
    log.append(
      element(document, "p", "studio-empty", "A conversa ainda não começou."),
    );
    return log;
  }
  for (const message of model.chat.messages) {
    const article = element(document, "article", "studio-message");
    if (message.isCurrentUser) {
      article.dataset.currentUser = "true";
    }
    const meta = element(document, "header");
    meta.append(
      element(document, "strong", undefined, message.authorName),
      element(document, "time", undefined, message.createdAtLabel),
    );
    article.append(meta, element(document, "p", undefined, message.body));
    log.append(article);
  }
  return log;
}

function createAssistant(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  drafts: StudioComposerDrafts,
  mode: StudioAssistantMode,
  onModeChange: (mode: StudioAssistantMode) => void,
): HTMLElement {
  const assistant = element(document, "div", "studio-assistant");
  assistant.dataset.assistantMode = mode;
  const header = element(document, "div", "studio-assistant__heading");
  header.append(
    element(document, "h2", undefined, "Assistente IA"),
    element(document, "span", "studio-status-chip", model.assistant.statusLabel),
  );
  const modeSelector = createAssistantModeSelector(
    document,
    idPrefix,
    mode,
    Boolean(model.assistant.pendingProposal),
    onModeChange,
  );
  const safety = element(
    document,
    "p",
    "studio-safety-note",
    mode === "ask"
      ? "Perguntar gera somente uma resposta. Nada é adicionado ao projeto."
      : "A candidata fica isolada. Adicionar cria apenas uma proposta; ainda será necessário testar e aprovar.",
  );
  assistant.append(
    header,
    modeSelector,
    createAssistantModelSelector(document, idPrefix, model, options),
    safety,
  );

  if (mode === "ask") {
    assistant.append(createAssistantConversation(document, model));
  } else {
    assistant.append(createAssistantProposalCandidate(document, model, options));
  }
  assistant.append(
    createAssistantComposer(document, idPrefix, model, options, drafts, mode),
  );
  return assistant;
}

function createAssistantModeSelector(
  document: Document,
  idPrefix: string,
  activeMode: StudioAssistantMode,
  hasPendingProposal: boolean,
  onChange: (mode: StudioAssistantMode) => void,
): HTMLElement {
  const selector = element(document, "div", "studio-assistant-modes");
  selector.setAttribute("role", "group");
  selector.setAttribute("aria-label", "Modo da assistente IA");
  for (const mode of [
    { id: "ask", label: "Perguntar" },
    {
      id: "propose",
      label: hasPendingProposal ? "Propor mudança (1)" : "Propor mudança",
    },
  ] as const satisfies readonly {
    id: StudioAssistantMode;
    label: string;
  }[]) {
    const button = element(document, "button", "studio-assistant-modes__button", mode.label);
    button.id = `${idPrefix}-assistant-mode-${mode.id}`;
    button.type = "button";
    button.dataset.assistantMode = mode.id;
    button.setAttribute("aria-pressed", String(mode.id === activeMode));
    button.addEventListener("click", () => onChange(mode.id));
    selector.append(button);
  }
  return selector;
}

function createAssistantConversation(
  document: Document,
  model: StudioShellModel,
): HTMLElement {
  const log = element(document, "div", "studio-message-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Conversa com a assistente IA");
  for (const message of model.assistant.messages) {
    const article = element(document, "article", "studio-message");
    article.dataset.messageRole = message.role;
    article.append(
      element(
        document,
        "strong",
        undefined,
        message.role === "assistant"
          ? "IA"
          : message.role === "user"
            ? "Você"
            : "Sistema",
      ),
      element(document, "p", undefined, message.body),
    );
    log.append(article);
  }
  if (model.assistant.messages.length === 0) {
    log.append(
      element(
        document,
        "p",
        "studio-empty",
        "Pergunte sobre o jogo, uma regra ou o contexto selecionado.",
      ),
    );
  }
  return log;
}

function createAssistantProposalCandidate(
  document: Document,
  model: StudioShellModel,
  options: StudioShellOptions,
): HTMLElement {
  const candidate = model.assistant.pendingProposal;
  if (!candidate) {
    const empty = element(document, "div", "studio-assistant-proposal-empty");
    empty.append(
      element(document, "strong", undefined, "Nenhuma mudança aguardando decisão"),
      element(
        document,
        "p",
        undefined,
        "Descreva uma mudança. A IA mostrará operações e riscos antes de você decidir adicioná-la às propostas.",
      ),
    );
    return empty;
  }

  const status = ASSISTANT_PROPOSAL_STATUS[candidate.status];
  const card = element(document, "article", "studio-assistant-proposal");
  card.dataset.proposalStatus = candidate.status;
  card.dataset.assistantProposalId = candidate.id;

  const heading = element(document, "header", "studio-assistant-proposal__heading");
  const identity = element(document, "div", "studio-assistant-proposal__identity");
  const isolationBadge = element(
    document,
    "span",
    "studio-assistant-proposal__isolation-badge",
    "NÃO APLICADA",
  );
  identity.append(
    isolationBadge,
    element(document, "h3", undefined, candidate.title),
  );
  const statusBadge = element(
    document,
    "span",
    "studio-status-chip",
    status.label,
  );
  statusBadge.dataset.tone = status.tone;
  heading.append(identity, statusBadge);

  const statusMessage = element(
    document,
    "p",
    "studio-assistant-proposal__status",
    candidate.statusMessage,
  );
  statusMessage.setAttribute("role", "status");
  statusMessage.setAttribute("aria-live", "polite");

  card.append(
    heading,
    element(
      document,
      "p",
      "studio-assistant-proposal__explanation",
      candidate.explanation,
    ),
    createAssistantProposalList(
      document,
      "Operações propostas",
      candidate.operations,
      "Nenhuma operação estruturada foi gerada.",
    ),
    createAssistantProposalList(
      document,
      "Riscos para revisar",
      candidate.risks,
      "Nenhum risco adicional informado pela IA.",
    ),
    statusMessage,
  );

  const actions = element(document, "footer", "studio-assistant-proposal__actions");
  const discard = element(document, "button", undefined, "Descartar");
  discard.type = "button";
  discard.dataset.testid = "studio-discard-assistant-proposal";
  discard.addEventListener("click", () => {
    void options.onDiscardAssistantProposal?.(candidate.id);
  });
  const accept = element(
    document,
    "button",
    "studio-assistant-proposal__accept",
    "Adicionar às propostas",
  );
  accept.type = "button";
  accept.disabled = candidate.status !== "ready";
  accept.dataset.testid = "studio-accept-assistant-proposal";
  accept.addEventListener("click", () => {
    if (candidate.status === "ready") {
      void options.onAcceptAssistantProposal?.(candidate.id);
    }
  });
  actions.append(discard, accept);
  card.append(actions);
  return card;
}

function createAssistantProposalList(
  document: Document,
  title: string,
  items: readonly string[],
  emptyMessage: string,
): HTMLElement {
  const section = element(document, "section", "studio-assistant-proposal__list");
  section.append(element(document, "h4", undefined, title));
  const list = element(document, "ul");
  if (items.length === 0) {
    const empty = element(document, "li", "studio-assistant-proposal__empty", emptyMessage);
    list.append(empty);
  } else {
    for (const item of items) {
      list.append(element(document, "li", undefined, item));
    }
  }
  section.append(list);
  return section;
}

function createAssistantComposer(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
  drafts: StudioComposerDrafts,
  mode: StudioAssistantMode,
): HTMLFormElement {
  const isProposalMode = mode === "propose";
  const draftKey = isProposalMode ? "assistantPropose" : "assistantAsk";

  const form = element(document, "form", "studio-composer") as HTMLFormElement;
  const label = element(
    document,
    "label",
    "studio-sr-only",
    isProposalMode ? "Mudança para a IA propor" : "Pergunta para a IA",
  );
  const input = document.createElement("textarea");
  input.rows = 3;
  input.value = drafts[draftKey];
  input.placeholder = isProposalMode
    ? "Ex.: proponha uma patrulha simples para este mob"
    : "Ex.: explique como funciona a movimentação deste mob";
  input.disabled =
    (isProposalMode
      ? !model.assistant.canPropose
      : !model.assistant.canPrompt) ||
    model.assistant.state !== "ready" ||
    model.assistant.selectedModelId === null;
  label.htmlFor = `${idPrefix}-assistant-${mode}-prompt`;
  input.id = label.htmlFor;
  input.addEventListener("input", () => {
    drafts[draftKey] = input.value;
  });
  const button = element(
    document,
    "button",
    undefined,
    isProposalMode ? "Preparar proposta" : "Enviar pergunta",
  );
  button.type = "submit";
  button.disabled = input.disabled;
  form.append(label, input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = input.value.trim();
    const selectedModelId = model.assistant.selectedModelId;
    if (!prompt || input.disabled || !selectedModelId) {
      return;
    }
    input.value = "";
    drafts[draftKey] = "";
    if (isProposalMode) {
      void options.onProposeWithAssistant?.(prompt, selectedModelId);
    } else {
      void options.onAskAssistant?.(prompt, selectedModelId);
    }
  });
  return form;
}

function createAssistantModelSelector(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  options: StudioShellOptions,
): HTMLElement {
  const wrapper = element(document, "label", "studio-model-selector");
  wrapper.append(element(document, "span", undefined, "Modelo"));
  const select = document.createElement("select");
  select.id = `${idPrefix}-assistant-model`;
  select.disabled = model.assistant.models.length === 0;
  select.setAttribute("aria-label", "Modelo da assistente IA");
  if (model.assistant.models.length === 0) {
    const option = document.createElement("option");
    option.textContent = "Nenhum modelo disponível";
    select.append(option);
  }
  for (const modelOption of model.assistant.models) {
    const option = document.createElement("option");
    option.value = modelOption.id;
    option.selected = modelOption.id === model.assistant.selectedModelId;
    option.textContent = `${modelOption.label} · ${formatContextWindow(
      modelOption.contextWindow,
    )}`;
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (model.assistant.models.some(({ id }) => id === select.value)) {
      options.onAssistantModelChange?.(select.value);
    }
  });
  const selected = model.assistant.models.find(
    ({ id }) => id === model.assistant.selectedModelId,
  );
  const help = element(
    document,
    "small",
    undefined,
    selected
      ? `${formatContextWindow(selected.contextWindow)} disponíveis. O contexto enviado continuará limitado à conversa e seleção atuais.`
      : "Escolha um modelo disponível no servidor.",
  );
  wrapper.append(select, help);
  return wrapper;
}

function createBottomPanel(
  document: Document,
  idPrefix: string,
  model: StudioShellModel,
  onTabChange: (tab: StudioBottomPanelTab) => void,
): HTMLElement {
  const panel = element(document, "section", "studio-bottom-panel");
  panel.setAttribute("aria-label", "Alterações e verificações");
  panel.append(
    createTabList(
      document,
      `${idPrefix}-bottom`,
      "Detalhes da proposta",
      BOTTOM_TABS,
      model.bottomPanelTab,
      onTabChange,
    ),
  );
  for (const tab of BOTTOM_TABS) {
    const tabPanel = element(document, "section", "studio-bottom-panel__content");
    tabPanel.id = `${idPrefix}-bottom-panel-${tab.id}`;
    tabPanel.setAttribute("role", "tabpanel");
    tabPanel.setAttribute("aria-labelledby", `${idPrefix}-bottom-tab-${tab.id}`);
    tabPanel.hidden = tab.id !== model.bottomPanelTab;
    tabPanel.append(createPanelItems(document, model[tab.id], tab.label));
    panel.append(tabPanel);
  }
  return panel;
}

function createPanelItems(
  document: Document,
  items: readonly StudioPanelItem[],
  label: string,
): HTMLElement {
  const list = element(document, "ul", "studio-detail-list");
  list.setAttribute("aria-label", label);
  if (items.length === 0) {
    const empty = element(document, "li", "studio-empty", "Nada para mostrar.");
    list.append(empty);
    return list;
  }
  for (const item of items) {
    const listItem = element(document, "li", "studio-detail-item");
    listItem.dataset.tone = item.tone ?? "neutral";
    listItem.append(element(document, "strong", undefined, item.title));
    if (item.detail) {
      listItem.append(element(document, "span", undefined, item.detail));
    }
    list.append(listItem);
  }
  return list;
}

function createTabList<Tab extends string>(
  document: Document,
  idPrefix: string,
  ariaLabel: string,
  tabs: readonly { readonly id: Tab; readonly label: string }[],
  activeTab: Tab,
  onChange: (tab: Tab) => void,
): HTMLElement {
  const list = element(document, "div", "studio-tab-list");
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", ariaLabel);
  const buttons: HTMLButtonElement[] = [];
  for (const tab of tabs) {
    const button = element(document, "button", "studio-tab", tab.label);
    button.id = `${idPrefix}-tab-${tab.id}`;
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab.id === activeTab));
    button.setAttribute("aria-controls", `${idPrefix}-panel-${tab.id}`);
    button.tabIndex = tab.id === activeTab ? 0 : -1;
    button.addEventListener("click", () => {
      onChange(tab.id);
    });
    buttons.push(button);
    list.append(button);
  }
  list.addEventListener("keydown", (event) => {
    const currentIndex = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = tabIndexFromKeyboard(event.key, currentIndex, buttons.length);
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    if (next) {
      onChange(next.id);
    }
  });
  return list;
}

export function tabIndexFromKeyboard(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count <= 0) {
    return null;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return count - 1;
  }
  if (key === "ArrowRight") {
    return (currentIndex + 1) % count;
  }
  if (key === "ArrowLeft") {
    return (currentIndex - 1 + count) % count;
  }
  return null;
}

export function resolveStudioLayout(
  preference: StudioLayoutPreference,
  signals: StudioLayoutSignals,
): StudioResolvedLayout {
  if (preference !== "auto") {
    return preference;
  }

  const containerWidth = finitePositive(signals.containerWidth);
  const viewportWidth = finitePositive(signals.viewportWidth);
  const availableWidth = Math.min(containerWidth, viewportWidth);
  if (availableWidth <= 768) {
    return "mobile";
  }
  if (signals.coarsePointer && availableWidth <= 1_100) {
    return "mobile";
  }
  return "desktop";
}

function readLayoutSignals(
  container: HTMLElement,
  document: Document,
): StudioLayoutSignals {
  const viewportWidth = finitePositive(document.defaultView?.innerWidth ?? 1_280);
  let containerWidth = viewportWidth;
  if (typeof container.getBoundingClientRect === "function") {
    const measuredWidth = container.getBoundingClientRect().width;
    if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
      containerWidth = measuredWidth;
    }
  }
  return {
    containerWidth,
    viewportWidth,
    coarsePointer:
      document.defaultView?.matchMedia?.("(pointer: coarse)").matches ?? false,
  };
}

function observeLayoutChanges(
  container: HTMLElement,
  document: Document,
  onChange: () => void,
): () => void {
  const view = document.defaultView;
  const pointerQuery = view?.matchMedia?.("(pointer: coarse)") ?? null;
  view?.addEventListener("resize", onChange);
  pointerQuery?.addEventListener("change", onChange);

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          onChange();
        });
  resizeObserver?.observe(container);

  return () => {
    view?.removeEventListener("resize", onChange);
    pointerQuery?.removeEventListener("change", onChange);
    resizeObserver?.disconnect();
  };
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1_280;
}

function appendStat(
  document: Document,
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const wrapper = element(document, "div", "studio-stat");
  wrapper.append(
    element(document, "dt", undefined, label),
    element(document, "dd", undefined, value),
  );
  list.append(wrapper);
}

function createProposalStatus(
  document: Document,
  status: StudioProposalStatus,
): HTMLElement {
  const meta = PROPOSAL_STATUS[status];
  const chip = element(document, "span", "studio-proposal-status", meta.label);
  chip.dataset.tone = meta.tone;
  return chip;
}

function selectedProposal(model: StudioShellModel) {
  return model.proposals.find(
    (proposal) => proposal.id === model.selectedProposalId,
  );
}

function presenceLabel(presence: "online" | "idle" | "offline"): string {
  if (presence === "online") {
    return "online";
  }
  if (presence === "idle") {
    return "ausente";
  }
  return "offline";
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function appendProjectFileMetadata(
  document: Document,
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const item = element(document, "div");
  item.append(
    element(document, "dt", undefined, label),
    element(document, "dd", undefined, value),
  );
  list.append(item);
}

function projectFileParentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1_048_576) {
    return `${(sizeBytes / 1_024).toFixed(sizeBytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(sizeBytes / 1_048_576).toFixed(1)} MB`;
}

function formatProjectFileText(path: string, content: string): string {
  if (!/\.json$/i.test(path)) {
    return content;
  }
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function markdownLineKind(line: string): string {
  const trimmed = line.trimStart();
  if (/^#{1,6}\s/.test(trimmed)) return "heading";
  if (/^(?:[-*+] |\d+\. )/.test(trimmed)) return "list";
  if (/^```/.test(trimmed)) return "fence";
  if (/^>\s?/.test(trimmed)) return "quote";
  return "text";
}

function isProjectFileVisibleInShell(path: string): boolean {
  if (
    !path ||
    path !== path.trim() ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  return path.split("/").every((part) => {
    const normalized = part.toLowerCase();
    return (
      part.length > 0 &&
      part !== "." &&
      part !== ".." &&
      normalized !== ".git" &&
      normalized !== "node_modules" &&
      normalized !== ".env" &&
      !normalized.startsWith(".env.")
    );
  });
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tagName);
  if (className) {
    result.className = className;
  }
  if (text !== undefined) {
    result.textContent = text;
  }
  return result;
}
