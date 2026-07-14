import {
  DEFAULT_GAME_PROJECT,
  parseGameProject,
  type GameProject,
} from "../core";
import {
  StudioApiError,
  createStudioFetchTransport,
  createStudioServerApiClient,
  normalizeStudioServerUrl,
  type StudioBackendRole,
  type StudioChangeSetDto,
  type StudioChatMessageDto,
  type StudioProjectSummaryDto,
  type StudioPublicUserDto,
  type StudioServerApiClient,
  type StudioSessionDto,
} from "./api-client";
import {
  chooseStudioModel,
  describeStudioModel,
} from "./assistant-models";
import type {
  StudioAssistantMessage,
  StudioConnectionState,
  StudioMemberSummary,
  StudioProposalStatus,
  StudioRole,
  StudioShellHandle,
  StudioShellModel,
} from "./model";
import { createStudioRealtime } from "./realtime";
import {
  applyStudioRealtimeMessage,
  memberFromStudioUser,
} from "./realtime-events";
import {
  STUDIO_LAYOUT_STORAGE_KEY,
  STUDIO_PROJECT_STORAGE_KEY,
  STUDIO_SERVER_STORAGE_KEY,
  configuredStudioServerUrl,
  editorUrlFromStudio,
  inviteTokenFromUrl,
  readLayoutPreference,
  safeStorageGet,
  safeStorageSet,
  urlWithoutInviteToken,
} from "./routing";
import { createStudioShell } from "./studio-shell";

const DEFAULT_MODEL_ID = "deepseek-v4-flash";

export interface StudioApplicationHandle {
  destroy(): void;
}

/** Mounts the authenticated Studio without exposing session or provider secrets. */
export async function mountStudioApplication(
  root: HTMLElement,
): Promise<StudioApplicationHandle> {
  const pageUrl = new URL(window.location.href);
  const storage = window.localStorage;
  let shell: StudioShellHandle | null = null;
  let realtime: ReturnType<typeof createStudioRealtime> | null = null;
  let destroyed = false;

  const destroyRuntime = (): void => {
    realtime?.destroy();
    realtime = null;
    shell?.destroy();
    shell = null;
  };
  const exitStudio = (): void => {
    window.location.assign(editorUrlFromStudio(pageUrl));
  };

  const connect = async (serverUrl: string): Promise<void> => {
    if (destroyed) return;
    destroyRuntime();
    renderLoading(root, "Conectando ao Estúdio…", exitStudio);
    let client: StudioServerApiClient;
    try {
      const normalized = normalizeStudioServerUrl(serverUrl);
      safeStorageSet(storage, STUDIO_SERVER_STORAGE_KEY, normalized.toString());
      client = createStudioServerApiClient(
        createStudioFetchTransport({ baseUrl: normalized.toString() }),
      );
    } catch (error) {
      renderServerConfiguration(root, serverUrl, errorMessage(error), connect, exitStudio);
      return;
    }

    try {
      const session = await client.getSession();
      scrubInviteFragment(pageUrl);
      await loadProjects(client, session);
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 401) {
        renderInviteRedemption(
          root,
          inviteTokenFromUrl(pageUrl),
          async (token, displayName, setError) => {
            try {
              const session = await client.redeemInvite(token, displayName);
              scrubInviteFragment(pageUrl);
              await loadProjects(client, session);
            } catch (redeemError) {
              setError(errorMessage(redeemError));
            }
          },
          exitStudio,
        );
        return;
      }
      renderServerConfiguration(root, serverUrl, errorMessage(error), connect, exitStudio);
    }
  };

  const loadProjects = async (
    client: StudioServerApiClient,
    session: StudioSessionDto,
  ): Promise<void> => {
    renderLoading(root, "Carregando projetos…", exitStudio);
    try {
      const projects = await client.listProjects();
      const rememberedProjectId = safeStorageGet(storage, STUDIO_PROJECT_STORAGE_KEY);
      const rememberedProject = projects.find(({ id }) => id === rememberedProjectId);
      if (rememberedProject) {
        await openProject(client, session, rememberedProject);
        return;
      }
      if (projects.length === 1 && projects[0]) {
        await openProject(client, session, projects[0]);
        return;
      }
      renderProjectSelection(
        root,
        projects,
        session.user,
        (project) => void openProject(client, session, project),
        session.user.role === "owner"
          ? async (name, setError) => {
              try {
                const created = await client.createProject(
                  name,
                  structuredClone(DEFAULT_GAME_PROJECT) as unknown as Record<string, unknown>,
                  "Projeto inicial criado pela Oficina do Labirinto.",
                );
                await openProject(client, session, created.project);
              } catch (error) {
                setError(errorMessage(error));
              }
            }
          : null,
        exitStudio,
      );
    } catch (error) {
      renderFailure(root, "Não foi possível carregar os projetos.", errorMessage(error), exitStudio);
    }
  };

  const openProject = async (
    client: StudioServerApiClient,
    session: StudioSessionDto,
    projectSummary: StudioProjectSummaryDto,
  ): Promise<void> => {
    safeStorageSet(storage, STUDIO_PROJECT_STORAGE_KEY, projectSummary.id);
    renderLoading(root, `Abrindo ${projectSummary.name}…`, exitStudio);
    try {
      const [snapshot, chatMessages, modelResult, changeSetResult] = await Promise.all([
        client.getProjectSnapshot(projectSummary.id),
        client.listChat(projectSummary.id),
        client.listModels().then(
          (models) => ({ models, error: null as string | null }),
          (error: unknown) => ({ models: [], error: errorMessage(error) }),
        ),
        client.listChangeSets(projectSummary.id).then(
          (changeSets) => ({ changeSets, error: null as string | null }),
          (error: unknown) => ({ changeSets: [], error: errorMessage(error) }),
        ),
      ]);
      const gameProject = parseGameProject(snapshot.revision.snapshot);
      const runtime = createProjectRuntime({
        root,
        client,
        session,
        project: gameProject,
        projectSummary: snapshot.project,
        revisionNumber: snapshot.revision.revision,
        initialChat: chatMessages,
        initialChangeSets: changeSetResult.changeSets,
        proposalError: changeSetResult.error,
        availableModelIds: modelResult.models.map(({ id }) => id),
        modelError: modelResult.error,
        storage,
        exitStudio,
      });
      shell = runtime.shell;
      realtime = runtime.realtime;
    } catch (error) {
      renderFailure(root, "O projeto não pôde ser aberto.", errorMessage(error), exitStudio);
    }
  };

  const configuredUrl = configuredStudioServerUrl(
    pageUrl,
    storage,
    import.meta.env.VITE_STUDIO_SERVER_URL,
  );
  if (configuredUrl) {
    await connect(configuredUrl);
  } else {
    renderServerConfiguration(root, "", "", connect, exitStudio);
  }

  const onPageHide = (): void => destroyRuntime();
  window.addEventListener("pagehide", onPageHide, { once: true });
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("pagehide", onPageHide);
      destroyRuntime();
    },
  };
}

interface ProjectRuntimeInput {
  readonly root: HTMLElement;
  readonly client: StudioServerApiClient;
  readonly session: StudioSessionDto;
  readonly project: GameProject;
  readonly projectSummary: StudioProjectSummaryDto;
  readonly revisionNumber: number;
  readonly initialChat: readonly StudioChatMessageDto[];
  readonly initialChangeSets: readonly StudioChangeSetDto[];
  readonly proposalError: string | null;
  readonly availableModelIds: readonly string[];
  readonly modelError: string | null;
  readonly storage: Storage;
  readonly exitStudio: () => void;
}

function createProjectRuntime(input: ProjectRuntimeInput): {
  readonly shell: StudioShellHandle;
  readonly realtime: ReturnType<typeof createStudioRealtime>;
} {
  let chatMessages = [...input.initialChat];
  let changeSets = [...input.initialChangeSets];
  let sharedProject = input.project;
  let sharedRevisionNumber = input.revisionNumber;
  let sharedRevisionUpdatedAt = input.projectSummary.updatedAt;
  let assistantMessages: StudioAssistantMessage[] = [];
  let actionError: string | null = null;
  let approvalInFlight = false;
  let connectionState: StudioConnectionState = "syncing";
  let members = new Map<string, StudioMemberSummary>();
  let selectedChangeSetId = changeSets[0]?.changeSetId ?? null;
  let selectedModelId = chooseStudioModel(
    input.availableModelIds,
    safeStorageGet(input.storage, modelStorageKey(input.projectSummary.id)),
  );
  let layoutPreference = readLayoutPreference(input.storage);
  let rightPanelTab: StudioShellModel["rightPanelTab"] = "inspector";
  let bottomPanelTab: StudioShellModel["bottomPanelTab"] = "changes";
  let mobileView: StudioShellModel["mobileView"] = "sandbox";
  let comparisonTarget: StudioShellModel["comparisonTarget"] = selectedChangeSetId
    ? "candidate"
    : "current";
  let shell: StudioShellHandle;

  members.set(
    `session:${input.session.user.id}`,
    memberFromStudioUser(input.session.user),
  );

  const buildModel = (): StudioShellModel => {
    const selected = changeSets.find(({ changeSetId }) => changeSetId === selectedChangeSetId) ?? null;
    const candidateDigest = selected?.candidateRevision?.digest ?? null;
    const exactPassingTest =
      selected?.latestTest?.status === "passed" &&
      selected.latestTest.revisionId === selected.candidateRevision?.revisionId &&
      selected.latestTest.revisionDigest === candidateDigest
        ? selected.latestTest
        : null;
    const failedChecks = selected?.latestTest?.checks.filter(({ status }) => status === "failed") ?? [];
    const modelOptions = input.availableModelIds.map(describeStudioModel);
    return {
      workspaceId: input.projectSummary.id,
      projectName: input.projectSummary.name,
      currentUserId: input.session.user.id,
      role: shellRole(input.session.user.role),
      connectionState,
      publishedVersion: `revisão ${sharedRevisionNumber}`,
      deploymentLabel: formatDate(sharedRevisionUpdatedAt),
      members: [...members.values()],
      proposals: changeSets.map(changeSetSummary),
      selectedProposalId: selectedChangeSetId,
      comparisonTarget,
      rightPanelTab,
      bottomPanelTab,
      mobileView,
      layoutPreference,
      inspector: {
        selectionLabel: selected?.title ?? sharedProject.name,
        description: selected?.explanation ?? "Projeto compartilhado atualmente publicado.",
        fields: [
          { id: "seed", label: "Seed", value: sharedProject.seed },
          {
            id: "player",
            label: "Vida do jogador",
            value: String(sharedProject.player.maxHealth),
          },
          {
            id: "enemy",
            label: "Inimigo básico",
            value: sharedProject.enemy.name,
          },
        ],
      },
      chat: {
        channelId: input.projectSummary.id,
        channelLabel: "Conversa do projeto",
        messages: chatMessages.map((message) => ({
          id: message.id,
          authorName: message.author?.displayName ?? (message.kind === "system" ? "Sistema" : "IA"),
          body: message.body,
          createdAtLabel: formatDate(message.createdAt),
          isCurrentUser: message.author?.id === input.session.user.id,
        })),
        canPost: input.session.user.role !== "viewer",
      },
      assistant: {
        state: input.availableModelIds.length > 0 ? "ready" : "unavailable",
        statusLabel: input.modelError ?? (input.availableModelIds.length > 0 ? "Pronta" : "Indisponível"),
        messages: assistantMessages,
        canPrompt: input.availableModelIds.length > 0,
        models: modelOptions,
        selectedModelId,
      },
      changes: selected
        ? selected.operations.map((operation, index) => ({
            id: `${selected.changeSetId}:${index}`,
            title: operationTitle(operation, index),
            detail: "Alteração versionada no change set.",
          }))
        : [],
      problems: [
        ...(actionError
          ? [
              {
                id: "studio-action",
                title: "A ação não foi concluída",
                detail: actionError,
                tone: "error" as const,
              },
            ]
          : []),
        ...(input.proposalError
          ? [{ id: "proposal-api", title: "Propostas indisponíveis", detail: input.proposalError, tone: "warning" as const }]
          : []),
        ...failedChecks.map((check) => ({
          id: check.checkId,
          title: check.name,
          detail: check.details ?? "Verificação falhou.",
          tone: "error" as const,
        })),
      ],
      tests: selected?.latestTest
        ? selected.latestTest.checks.map((check) => ({
            id: check.checkId,
            title: check.name,
            ...(check.details ? { detail: check.details } : {}),
            tone: check.status === "passed" ? "success" as const : "error" as const,
          }))
        : [],
      activity: [
        {
          id: "revision",
          title: `Revisão ${sharedRevisionNumber}`,
          detail: formatDate(sharedRevisionUpdatedAt),
        },
      ],
      approval: {
        candidateRevisionId: selected?.candidateRevision?.revisionId ?? null,
        testedRevisionId: exactPassingTest?.revisionId ?? null,
        validationState: selected?.latestTest
          ? selected.latestTest.status === "passed" ? "passed" : "failed"
          : "pending",
        unresolvedProblemCount: failedChecks.length,
        isSubmitting: approvalInFlight,
        isPublishing: selected?.status === "publishing",
      },
    };
  };

  const refresh = (): void => shell.update(buildModel());
  shell = createStudioShell(input.root, buildModel(), {
    onExitStudio: input.exitStudio,
    onSelectProposal(changeSetId) {
      selectedChangeSetId = changeSetId;
      comparisonTarget = "candidate";
      refresh();
    },
    onComparisonChange(target) {
      comparisonTarget = target;
    },
    onRightPanelChange(tab) {
      rightPanelTab = tab;
    },
    onBottomPanelChange(tab) {
      bottomPanelTab = tab;
    },
    onMobileViewChange(view) {
      mobileView = view;
    },
    onLayoutPreferenceChange(preference) {
      layoutPreference = preference;
      safeStorageSet(input.storage, STUDIO_LAYOUT_STORAGE_KEY, preference);
    },
    async onLogout() {
      try {
        await input.client.logout();
        input.exitStudio();
      } catch (error) {
        actionError = `Não foi possível encerrar a sessão: ${errorMessage(error)}`;
        refresh();
      }
    },
    onAssistantModelChange(modelId) {
      selectedModelId = modelId;
      safeStorageSet(input.storage, modelStorageKey(input.projectSummary.id), modelId);
      refresh();
    },
    async onSendChat(_channelId, body) {
      try {
        const message = await input.client.sendChat(input.projectSummary.id, body);
        chatMessages = appendUniqueChat(chatMessages, message);
        actionError = null;
        refresh();
      } catch (error) {
        actionError = `Não foi possível enviar a mensagem: ${errorMessage(error)}`;
        refresh();
      }
    },
    async onAskAssistant(prompt, modelId) {
      assistantMessages = [
        ...assistantMessages,
        { id: crypto.randomUUID(), role: "user", body: prompt, createdAtLabel: "agora" },
      ];
      refresh();
      try {
        const reply = await input.client.advisoryChat(
          narrowAssistantContext(assistantMessages, sharedProject),
          modelId || DEFAULT_MODEL_ID,
        );
        assistantMessages = [
          ...assistantMessages,
          { id: reply.id ?? crypto.randomUUID(), role: "assistant", body: reply.content, createdAtLabel: "agora" },
        ];
      } catch (error) {
        assistantMessages = [...assistantMessages, systemMessage(errorMessage(error))];
      }
      refresh();
    },
    async onApprove(request) {
      if (approvalInFlight) return;
      const selected = changeSets.find(({ changeSetId }) => changeSetId === request.proposalId);
      const candidate = selected?.candidateRevision;
      const latestTest = selected?.latestTest;
      if (
        input.session.user.role !== "owner" ||
        !candidate ||
        latestTest?.status !== "passed" ||
        latestTest.revisionId !== candidate.revisionId ||
        latestTest.revisionDigest !== candidate.digest ||
        request.revisionId !== candidate.revisionId
      ) {
        return;
      }
      approvalInFlight = true;
      actionError = null;
      refresh();
      try {
        const updated = await input.client.reviewChangeSet(
          input.projectSummary.id,
          selected.changeSetId,
          {
            decision: "approve",
            revisionId: candidate.revisionId,
            revisionDigest: candidate.digest,
            explanation: "Revisão exata testada e aprovada no Estúdio.",
          },
        );
        changeSets = changeSets.map((changeSet) =>
          changeSet.changeSetId === updated.changeSetId ? updated : changeSet,
        );
      } catch (error) {
        actionError = `Não foi possível aprovar a proposta: ${errorMessage(error)}`;
      } finally {
        approvalInFlight = false;
        refresh();
      }
    },
  });

  const realtime = createStudioRealtime({
    transport: input.client.transport,
    projectId: input.projectSummary.id,
    onConnectionState(state) {
      connectionState =
        state === "connected"
          ? "connected"
          : state === "offline"
            ? "offline"
            : "syncing";
      refresh();
    },
    onMessage(message) {
      applyStudioRealtimeMessage(message, {
        replaceMembers(nextMembers) {
          members = nextMembers;
        },
        upsertMember(member) {
          members.set(member.id, member);
        },
        removeMember(clientId) {
          members.delete(clientId);
        },
        addChat(messageDto) {
          chatMessages = appendUniqueChat(chatMessages, messageDto);
        },
        upsertChangeSet(changeSet) {
          if (changeSet.projectId !== input.projectSummary.id) return;
          const alreadyVisible = changeSets.some(
            ({ changeSetId }) => changeSetId === changeSet.changeSetId,
          );
          changeSets = alreadyVisible
            ? changeSets.map((existing) =>
                existing.changeSetId === changeSet.changeSetId
                  ? changeSet
                  : existing,
              )
            : [changeSet, ...changeSets];
          selectedChangeSetId ??= changeSet.changeSetId;
        },
        applyProjectRevision(revision) {
          if (
            revision.projectId !== input.projectSummary.id ||
            revision.revisionNumber <= sharedRevisionNumber
          ) {
            return;
          }
          sharedProject = revision.project;
          sharedRevisionNumber = revision.revisionNumber;
          sharedRevisionUpdatedAt = revision.createdAt;
        },
      });
      refresh();
    },
  });
  return { shell, realtime };
}

function changeSetSummary(changeSet: StudioChangeSetDto) {
  return {
    id: changeSet.changeSetId,
    revisionId: changeSet.candidateRevision?.revisionId ?? `unavailable:${changeSet.changeSetId}`,
    title: changeSet.title,
    summary: changeSet.explanation,
    authorName: changeSet.author.displayName,
    updatedAtLabel: formatDate(changeSet.updatedAt),
    status: proposalStatus(changeSet.status),
    changeCount: changeSet.operations.length,
    problemCount: changeSet.latestTest?.checks.filter(({ status }) => status === "failed").length ?? 0,
  };
}

function proposalStatus(status: StudioChangeSetDto["status"]): StudioProposalStatus {
  switch (status) {
    case "draft": return "draft";
    case "proposed": return "ready_for_test";
    case "testing": return "testing";
    case "changes-requested": return "changes_requested";
    case "approved": return "approved";
    case "publishing": return "publishing";
    case "published": return "published";
    case "rejected": return "rejected";
    case "publish-failed":
    case "superseded": return "conflict";
  }
}

function shellRole(role: StudioBackendRole): StudioRole {
  return role === "owner" ? "owner" : role === "editor" ? "coauthor" : "tester";
}

function appendUniqueChat(
  messages: readonly StudioChatMessageDto[],
  message: StudioChatMessageDto,
): StudioChatMessageDto[] {
  return messages.some(({ id }) => id === message.id) ? [...messages] : [...messages, message];
}

function narrowAssistantContext(messages: readonly StudioAssistantMessage[], project: GameProject) {
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.body }));
  return [
    {
      role: "user" as const,
      content: `Contexto selecionado: projeto ${project.name}, seed ${project.seed}, inimigo básico ${project.enemy.name}.`,
    },
    ...conversation,
  ];
}

function systemMessage(body: string): StudioAssistantMessage {
  return { id: crypto.randomUUID(), role: "system", body, createdAtLabel: "agora" };
}

function modelStorageKey(projectId: string): string {
  return `oficina.studio.model:${projectId}`;
}

function operationTitle(operation: unknown, index: number): string {
  if (typeof operation === "object" && operation !== null) {
    const kind = (operation as { kind?: unknown }).kind;
    if (typeof kind === "string") return kind;
  }
  return `Alteração ${index + 1}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "data indisponível";
}

function scrubInviteFragment(pageUrl: URL): void {
  const sanitized = urlWithoutInviteToken(pageUrl);
  pageUrl.hash = sanitized.hash;
  window.history.replaceState(null, "", sanitized);
}

function renderLoading(root: HTMLElement, message: string, onExit: () => void): void {
  const card = gatewayCard(root.ownerDocument, "Estúdio compartilhado", message, onExit);
  card.setAttribute("aria-busy", "true");
  root.replaceChildren(card);
}

function renderServerConfiguration(
  root: HTMLElement,
  currentUrl: string,
  initialError: string,
  onConnect: (url: string) => Promise<void>,
  onExit: () => void,
): void {
  const card = gatewayCard(
    root.ownerDocument,
    "Conectar ao Estúdio",
    "Informe o endereço HTTPS do servidor compartilhado. Nenhuma chave de IA é enviada ao navegador.",
    onExit,
  );
  const form = root.ownerDocument.createElement("form");
  form.className = "studio-gateway__form";
  const input = root.ownerDocument.createElement("input");
  input.type = "url";
  input.required = true;
  input.value = currentUrl;
  input.placeholder = "https://studio.exemplo.com";
  input.setAttribute("aria-label", "URL do servidor do Estúdio");
  const error = gatewayError(root.ownerDocument, initialError);
  const submit = button(root.ownerDocument, "Conectar");
  form.append(input, error, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";
    void onConnect(input.value);
  });
  card.append(form);
  root.replaceChildren(card);
}

function renderInviteRedemption(
  root: HTMLElement,
  token: string | null,
  onRedeem: (
    token: string,
    displayName: string,
    setError: (message: string) => void,
  ) => Promise<void>,
  onExit: () => void,
): void {
  const card = gatewayCard(
    root.ownerDocument,
    "Entrar pelo convite",
    token
      ? "Escolha o nome que aparecerá para seu parceiro."
      : "Este link não contém um convite válido. Peça ao dono um novo link com #invite=.",
    onExit,
  );
  if (!token) {
    root.replaceChildren(card);
    return;
  }
  const form = root.ownerDocument.createElement("form");
  form.className = "studio-gateway__form";
  const name = root.ownerDocument.createElement("input");
  name.required = true;
  name.maxLength = 80;
  name.autocomplete = "name";
  name.placeholder = "Seu nome";
  name.setAttribute("aria-label", "Nome exibido no Estúdio");
  const error = gatewayError(root.ownerDocument, "");
  form.append(name, error, button(root.ownerDocument, "Aceitar convite"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void onRedeem(token, name.value.trim(), (message) => {
      error.textContent = message;
    });
  });
  card.append(form);
  root.replaceChildren(card);
}

function renderProjectSelection(
  root: HTMLElement,
  projects: readonly StudioProjectSummaryDto[],
  user: StudioPublicUserDto,
  onSelect: (project: StudioProjectSummaryDto) => void,
  onCreate: ((name: string, setError: (message: string) => void) => Promise<void>) | null,
  onExit: () => void,
): void {
  const card = gatewayCard(
    root.ownerDocument,
    "Projetos do Estúdio",
    `${user.displayName}, escolha o projeto compartilhado.`,
    onExit,
  );
  const list = root.ownerDocument.createElement("div");
  list.className = "studio-project-list";
  for (const project of projects) {
    const select = button(root.ownerDocument, `${project.name} · revisão ${project.latestRevision}`);
    select.addEventListener("click", () => onSelect(project));
    list.append(select);
  }
  card.append(list);
  if (onCreate) {
    const form = root.ownerDocument.createElement("form");
    form.className = "studio-gateway__form";
    const name = root.ownerDocument.createElement("input");
    name.value = DEFAULT_GAME_PROJECT.name;
    name.required = true;
    name.maxLength = 120;
    name.setAttribute("aria-label", "Nome do novo projeto");
    const error = gatewayError(root.ownerDocument, "");
    form.append(name, error, button(root.ownerDocument, "Criar projeto inicial"));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void onCreate(name.value.trim(), (message) => {
        error.textContent = message;
      });
    });
    card.append(form);
  }
  root.replaceChildren(card);
}

function renderFailure(root: HTMLElement, title: string, detail: string, onExit: () => void): void {
  root.replaceChildren(gatewayCard(root.ownerDocument, title, detail, onExit));
}

function gatewayCard(document: Document, title: string, detail: string, onExit: () => void): HTMLElement {
  const main = document.createElement("main");
  main.className = "studio-gateway";
  const card = document.createElement("section");
  card.className = "studio-gateway__card";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const description = document.createElement("p");
  description.textContent = detail;
  const exit = button(document, "Voltar ao editor");
  exit.className = "studio-gateway__exit";
  exit.addEventListener("click", onExit);
  card.append(heading, description, exit);
  main.append(card);
  return main;
}

function gatewayError(document: Document, message: string): HTMLElement {
  const error = document.createElement("p");
  error.className = "studio-gateway__error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  return error;
}

function button(document: Document, label: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "submit";
  result.textContent = label;
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Não foi possível alcançar o servidor. Verifique o endereço e a conexão.";
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado no Estúdio.";
}
