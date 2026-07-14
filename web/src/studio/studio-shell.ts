import "./studio.css";
import { formatContextWindow } from "./assistant-models";
import type {
  StudioApprovalControlState,
  StudioBottomPanelTab,
  StudioComparisonTarget,
  StudioLayoutPreference,
  StudioMobileView,
  StudioPanelItem,
  StudioProposalStatus,
  StudioResolvedLayout,
  StudioRightPanelTab,
  StudioSandboxControl,
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
  assistant: string;
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
  const drafts: StudioComposerDrafts = { chat: "", assistant: "" };

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
    refreshResolvedLayout();
    root.replaceChildren(
      createHeader(
        document,
        idPrefix,
        model,
        selectLayoutPreference,
        options.onExitStudio,
        options.onLogout,
      ),
      createOverview(document, idPrefix, model),
      createMainLayout(
        document,
        idPrefix,
        model,
        options,
        drafts,
        selectProposal,
        selectComparison,
        selectRightTab,
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
  onExitStudio: (() => void) | undefined,
  onLogout: (() => void | Promise<void>) | undefined,
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
  if (onExitStudio) {
    const exit = element(document, "button", "studio-exit-button", "Voltar ao editor");
    exit.type = "button";
    exit.addEventListener("click", onExitStudio);
    actions.append(exit);
  }
  if (onLogout) {
    const logout = element(
      document,
      "button",
      "studio-logout-button",
      "Encerrar sessão",
    );
    logout.type = "button";
    logout.addEventListener("click", () => void onLogout());
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
  onSelectProposal: (proposalId: string) => void,
  onComparisonChange: (target: StudioComparisonTarget) => void,
  onRightPanelChange: (tab: StudioRightPanelTab) => void,
): HTMLElement {
  const main = element(document, "main", "studio-main");
  main.append(
    createSidebar(document, model, onSelectProposal),
    createWorkspace(document, idPrefix, model, options, onComparisonChange),
    createRightPanel(
      document,
      idPrefix,
      model,
      options,
      drafts,
      onRightPanelChange,
    ),
  );
  return main;
}

function createSidebar(
  document: Document,
  model: StudioShellModel,
  onSelectProposal: (proposalId: string) => void,
): HTMLElement {
  const sidebar = element(document, "aside", "studio-sidebar");
  sidebar.setAttribute("aria-label", "Pessoas e propostas do projeto");

  const presenceSection = element(document, "section", "studio-panel-section");
  presenceSection.append(
    element(document, "h2", undefined, "No Estúdio"),
    createPresenceList(document, model),
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

  sidebar.append(presenceSection, proposalsSection);
  return sidebar;
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
  onComparisonChange: (target: StudioComparisonTarget) => void,
): HTMLElement {
  const workspace = element(document, "section", "studio-workspace");
  workspace.setAttribute("aria-labelledby", `${idPrefix}-workspace-title`);
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
      Boolean(selected),
      comparisonTarget,
      onComparisonChange,
    ),
  );

  const preview = element(document, "div", "studio-preview");
  preview.dataset.studioPreviewSlot = comparisonTarget;
  preview.setAttribute("role", "region");
  preview.setAttribute("tabindex", "0");
  preview.setAttribute(
    "aria-label",
    comparisonTarget === "current"
      ? `Prévia da versão publicada ${model.publishedVersion}`
      : `Prévia da proposta ${selected?.title ?? "não selecionada"}`,
  );
  const previewContent = element(document, "div", "studio-preview__placeholder");
  previewContent.append(
    element(document, "span", "studio-preview__icon", "▶"),
    element(
      document,
      "strong",
      undefined,
      comparisonTarget === "current"
        ? `Jogo atual · ${model.publishedVersion}`
        : selected?.title ?? "Candidata indisponível",
    ),
    element(
      document,
      "p",
      undefined,
      "Área reservada para o runtime Phaser ser montado de forma lazy.",
    ),
  );
  preview.append(previewContent);

  const touchControls = createTouchControls(document, options);

  const approval = createApprovalArea(document, idPrefix, model, options);
  workspace.append(heading, preview, touchControls, approval);
  return workspace;
}

function createComparisonSelector(
  document: Document,
  idPrefix: string,
  hasCandidate: boolean,
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
      comparisonTarget === "current",
      false,
      onComparisonChange,
    ),
    comparisonOption(
      document,
      `${idPrefix}-comparison-candidate`,
      "candidate",
      "Candidata",
      comparisonTarget === "candidate",
      !hasCandidate,
      onComparisonChange,
    ),
  );
  return fieldset;
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

function createTouchControls(
  document: Document,
  options: StudioShellOptions,
): HTMLElement {
  const controls = element(document, "div", "studio-touch-controls");
  controls.setAttribute("aria-label", "Controles de toque do sandbox");

  const movement = element(document, "div", "studio-touch-pad studio-touch-pad--movement");
  movement.setAttribute("role", "group");
  movement.setAttribute("aria-label", "Movimento");
  movement.append(
    createTouchButton(document, "move-up", "↑", "Mover para cima", options),
    createTouchButton(document, "move-left", "←", "Mover para esquerda", options),
    createTouchButton(document, "move-down", "↓", "Mover para baixo", options),
    createTouchButton(document, "move-right", "→", "Mover para direita", options),
  );

  const actions = element(document, "div", "studio-touch-pad studio-touch-pad--actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Ações do jogo");
  actions.append(
    createTouchButton(document, "fire", "●", "Atirar", options),
    createTouchButton(document, "action", "A", "Interagir", options),
    createTouchButton(document, "pause", "Ⅱ", "Pausar", options),
  );
  controls.append(movement, actions);
  return controls;
}

function createTouchButton(
  document: Document,
  control: StudioSandboxControl,
  label: string,
  ariaLabel: string,
  options: StudioShellOptions,
): HTMLButtonElement {
  const button = element(document, "button", "studio-touch-button", label);
  button.type = "button";
  button.dataset.control = control;
  button.setAttribute("aria-label", ariaLabel);
  let pressed = false;
  const start = (): void => {
    if (pressed) {
      return;
    }
    pressed = true;
    button.dataset.pressed = "true";
    options.onSandboxControl?.({ control, phase: "start" });
  };
  const end = (): void => {
    if (!pressed) {
      return;
    }
    pressed = false;
    delete button.dataset.pressed;
    options.onSandboxControl?.({ control, phase: "end" });
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    start();
  });
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("pointerleave", end);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      start();
    }
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      end();
    }
  });
  button.addEventListener("blur", end);
  return button;
}

function comparisonOption(
  document: Document,
  id: string,
  value: StudioComparisonTarget,
  label: string,
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
  wrapper.append(input, element(document, "span", undefined, label));
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
        createAssistant(document, idPrefix, model, options, drafts),
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
): HTMLElement {
  const assistant = element(document, "div", "studio-assistant");
  const header = element(document, "div", "studio-assistant__heading");
  header.append(
    element(document, "h2", undefined, "Assistente IA"),
    element(document, "span", "studio-status-chip", model.assistant.statusLabel),
  );
  const safety = element(
    document,
    "p",
    "studio-safety-note",
    "A IA recebe apenas o contexto selecionado e nunca publica diretamente no jogo.",
  );
  assistant.append(
    header,
    createAssistantModelSelector(document, idPrefix, model, options),
    safety,
  );

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
        "Escolha o contexto e peça uma explicação ou proposta.",
      ),
    );
  }
  assistant.append(log);

  const form = element(document, "form", "studio-composer") as HTMLFormElement;
  const label = element(document, "label", "studio-sr-only", "Pedido para a IA");
  const input = document.createElement("textarea");
  input.rows = 3;
  input.value = drafts.assistant;
  input.placeholder = "Ex.: proponha uma patrulha simples para este mob";
  input.disabled =
    !model.assistant.canPrompt ||
    model.assistant.state !== "ready" ||
    model.assistant.selectedModelId === null;
  label.htmlFor = `${idPrefix}-assistant-prompt`;
  input.id = label.htmlFor;
  input.addEventListener("input", () => {
    drafts.assistant = input.value;
  });
  const button = element(document, "button", undefined, "Enviar pedido");
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
    drafts.assistant = "";
    void options.onAskAssistant?.(prompt, selectedModelId);
  });
  assistant.append(form);
  return assistant;
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
