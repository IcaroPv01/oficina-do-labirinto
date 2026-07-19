import type { Page } from "@playwright/test";
import type { ChangeSet } from "@collaborative-roguelike/studio-contracts";
import defaultProject from "../../game-data/default-project.json" with { type: "json" };

export const studioInvitation =
  "invite-token-with-at-least-twenty-characters";
export const createdStudioInvitation =
  "created-invite-token-with-at-least-twenty-characters";

export const studioProjectFileSource = [
  'import "./style.css";',
  "",
  'export const studioTitle = "Oficina do Labirinto";',
  "",
].join("\n");

export const studioProjectFileEntry = {
  path: "web/src/main.ts",
  name: "main.ts",
  category: "source" as const,
  kind: "text" as const,
  mediaType: "text/typescript" as const,
  sizeBytes: new TextEncoder().encode(studioProjectFileSource).byteLength,
  sha256: "e".repeat(64),
};

export const studioSession = {
  user: {
    id: "owner-1",
    displayName: "Ícaro",
    role: "owner",
  },
  csrfToken: "csrf-test-only",
  expiresAt: "2026-07-20T12:00:00.000Z",
};

export const studioProject = {
  id: "project-1",
  name: "Oficina compartilhada",
  latestRevision: 1,
  createdBy: studioSession.user.id,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

const BASE_REVISION_DIGEST = "a".repeat(64);
const CANDIDATE_REVISION_DIGEST = "b".repeat(64);

const studioOwnerActor = {
  kind: "user" as const,
  userId: studioSession.user.id,
  displayName: studioSession.user.displayName,
  role: "owner" as const,
};

export const studioCandidateRevision = {
  schemaVersion: 1 as const,
  revisionId: "candidate-revision-1",
  projectId: studioProject.id,
  parentRevisionId: "revision-1",
  sequence: 1,
  digestAlgorithm: "sha256" as const,
  canonicalization: "jcs-rfc8785" as const,
  digest: CANDIDATE_REVISION_DIGEST,
  contentBytes: 512,
  createdAt: "2026-07-13T12:05:00.000Z",
  createdBy: studioOwnerActor,
};

const studioBaseRevision = {
  schemaVersion: 1 as const,
  revisionId: "revision-1",
  projectId: studioProject.id,
  parentRevisionId: null,
  sequence: 0,
  digestAlgorithm: "sha256" as const,
  canonicalization: "jcs-rfc8785" as const,
  digest: BASE_REVISION_DIGEST,
  contentBytes: 1_024,
  createdAt: "2026-07-13T12:00:00.000Z",
  createdBy: studioOwnerActor,
};

export const studioCandidateChangeSet = {
  schemaVersion: 1 as const,
  changeSetId: "change-set-mobile-1",
  workspaceId: studioProject.id,
  projectId: studioProject.id,
  title: "Herói mais veloz",
  explanation: "Aumenta a velocidade para validar a candidata no celular.",
  status: "proposed" as const,
  baseRevision: studioBaseRevision,
  candidateRevision: studioCandidateRevision,
  sourceProposalIds: [],
  operations: [
    {
      operationId: "operation-player-speed-1",
      kind: "player.set-tuning" as const,
      explanation: "Aumenta a velocidade sem alterar o restante do jogador.",
      tuning: { speed: 280 },
    },
  ],
  author: studioOwnerActor,
  createdAt: "2026-07-13T12:05:00.000Z",
  updatedAt: "2026-07-13T12:05:00.000Z",
  latestTest: null,
  review: null,
  publication: null,
  supersededByChangeSetId: null,
} satisfies ChangeSet;

export interface StudioBackendMockOptions {
  readonly initiallyAuthenticated?: boolean;
  readonly serverOrigin?: string;
}

/** Installs the smallest browser-level backend needed to exercise the gateway. */
export async function installStudioBackendMock(
  page: Page,
  options: StudioBackendMockOptions = {},
): Promise<void> {
  let authenticated = options.initiallyAuthenticated ?? false;
  let candidateChangeSet: ChangeSet = structuredClone(studioCandidateChangeSet);
  let aiDraftChangeSet: ChangeSet | null = null;
  const serverOrigin = options.serverOrigin ?? "https://studio.test";
  await page.route(`${serverOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const corsHeaders = {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Headers": "Content-Type, X-Studio-CSRF",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Content-Type": "application/json",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname === "/auth/me") {
      if (!authenticated) {
        await route.fulfill({
          status: 401,
          headers: corsHeaders,
          json: {
            error: {
              code: "authentication_required",
              message: "Autenticação necessária",
            },
          },
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: studioSession,
        });
      }
      return;
    }
    if (url.pathname === "/auth/invites/redeem") {
      authenticated = true;
      await route.fulfill({ status: 200, headers: corsHeaders, json: studioSession });
      return;
    }
    if (url.pathname === "/api/invites" && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        headers: corsHeaders,
        json: {
          invite: {
            id: "invite-created-browser-1",
            role: "editor",
            createdAt: "2026-07-18T12:00:00.000Z",
            expiresAt: "2026-07-19T12:00:00.000Z",
          },
          token: createdStudioInvitation,
        },
      });
      return;
    }
    if (url.pathname === "/auth/logout" && request.method() === "POST") {
      authenticated = false;
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname === "/api/projects") {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { projects: [studioProject] },
      });
      return;
    }
    if (url.pathname === `/api/projects/${studioProject.id}/snapshot`) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          project: studioProject,
          revision: {
            id: "revision-1",
            projectId: studioProject.id,
            revision: 1,
            parentRevision: null,
            snapshot: defaultProject,
            explanation: "Projeto inicial",
            createdBy: studioSession.user.id,
            createdAt: "2026-07-13T12:00:00.000Z",
          },
        },
      });
      return;
    }
    if (url.pathname === `/api/projects/${studioProject.id}/files`) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          schemaVersion: 1,
          projectId: studioProject.id,
          generatedAt: "2026-07-18T12:00:00.000Z",
          manifestDigest: "f".repeat(64),
          files: [studioProjectFileEntry],
        },
      });
      return;
    }
    if (url.pathname === `/api/projects/${studioProject.id}/files/content`) {
      const requestedPath = url.searchParams.get("path");
      if (requestedPath !== studioProjectFileEntry.path) {
        await route.fulfill({
          status: 404,
          headers: corsHeaders,
          json: { error: { code: "file_not_found", message: "Arquivo ausente" } },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          schemaVersion: 1,
          projectId: studioProject.id,
          entry: studioProjectFileEntry,
          encoding: "utf8",
          content: studioProjectFileSource,
        },
      });
      return;
    }
    if (url.pathname === `/api/projects/${studioProject.id}/chat`) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { body?: unknown };
        await route.fulfill({
          status: 201,
          headers: corsHeaders,
          json: {
            message: {
              id: "message-browser-1",
              projectId: studioProject.id,
              author: studioSession.user,
              kind: "human",
              body: typeof body.body === "string" ? body.body : "",
              createdAt: "2026-07-13T12:06:00.000Z",
            },
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { messages: [] },
      });
      return;
    }
    if (
      url.pathname ===
        `/api/projects/${studioProject.id}/change-sets/${studioCandidateChangeSet.changeSetId}/testing` &&
      request.method() === "POST"
    ) {
      candidateChangeSet = {
        ...candidateChangeSet,
        status: "testing",
        updatedAt: "2026-07-13T12:07:00.000Z",
      };
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { changeSet: candidateChangeSet, history: [], testRuns: [], reviews: [] },
      });
      return;
    }
    if (
      url.pathname ===
        `/api/projects/${studioProject.id}/change-sets/${studioCandidateChangeSet.changeSetId}/tests` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        revisionId: string;
        revisionDigest: string;
        status: "passed" | "failed";
        checks: Array<{
          checkId?: string;
          name: string;
          status: "passed" | "failed";
          details: string | null;
        }>;
        startedAt: string;
        completedAt: string;
      };
      candidateChangeSet = {
        ...candidateChangeSet,
        latestTest: {
          testRunId: "sandbox-test-mobile-1",
          revisionId: body.revisionId,
          revisionDigest: body.revisionDigest,
          status: body.status,
          checks: body.checks.map((check, index) => ({
            ...check,
            checkId: check.checkId ?? `sandbox-check-${index + 1}`,
          })),
          executedBy: studioOwnerActor,
          startedAt: body.startedAt,
          completedAt: body.completedAt,
        },
        updatedAt: "2026-07-13T12:08:00.000Z",
      };
      await route.fulfill({
        status: 201,
        headers: corsHeaders,
        json: {
          changeSet: candidateChangeSet,
          history: [],
          testRuns: [candidateChangeSet.latestTest],
          reviews: [],
        },
      });
      return;
    }
    if (
      url.pathname ===
        `/api/projects/${studioProject.id}/change-sets/${studioCandidateChangeSet.changeSetId}/review` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        decision: "approve";
        revisionId: string;
        revisionDigest: string;
        explanation: string;
      };
      const decidedAt = new Date().toISOString();
      candidateChangeSet = {
        ...candidateChangeSet,
        status: "approved",
        review: {
          decision: body.decision,
          revisionId: body.revisionId,
          revisionDigest: body.revisionDigest,
          decidedBy: studioOwnerActor,
          explanation: body.explanation,
          decidedAt,
        },
        updatedAt: decidedAt,
      };
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { changeSet: candidateChangeSet },
      });
      return;
    }
    if (
      url.pathname === `/api/projects/${studioProject.id}/change-sets` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        title: string;
        explanation: string;
        operations: ChangeSet["operations"];
        sourceProposalIds?: string[];
      };
      aiDraftChangeSet = {
        ...structuredClone(studioCandidateChangeSet),
        changeSetId: "change-set-ai-draft-1",
        title: body.title,
        explanation: body.explanation,
        status: "draft",
        candidateRevision: {
          ...studioCandidateRevision,
          revisionId: "candidate-revision-ai-1",
          digest: "c".repeat(64),
          createdAt: "2026-07-13T12:10:00.000Z",
        },
        sourceProposalIds: body.sourceProposalIds ?? [],
        operations: body.operations,
        createdAt: "2026-07-13T12:10:00.000Z",
        updatedAt: "2026-07-13T12:10:00.000Z",
      };
      await route.fulfill({
        status: 201,
        headers: corsHeaders,
        json: { changeSet: aiDraftChangeSet, history: [], testRuns: [], reviews: [] },
      });
      return;
    }
    if (url.pathname.endsWith("/change-sets")) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { changeSets: [aiDraftChangeSet, candidateChangeSet].filter(Boolean) },
      });
      return;
    }
    if (url.pathname === "/api/ai/models") {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { models: [{ id: "deepseek-v4-flash" }] },
      });
      return;
    }
    if (url.pathname === "/api/ai/chat" && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          mode: "advisory",
          applied: false,
          reply: {
            id: "assistant-browser-1",
            model: "deepseek-v4-flash",
            content: "Sugestão isolada; nada foi aplicado ao jogo.",
          },
        },
      });
      return;
    }
    if (url.pathname === "/api/ai/propose" && request.method() === "POST") {
      const body = request.postDataJSON() as { projectId?: unknown };
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          mode: "proposal",
          applied: false,
          proposalId: "ai-proposal-browser-1",
          projectId: body.projectId,
          createdAt: "2026-07-13T12:09:00.000Z",
          promptDigest: "d".repeat(64),
          author: studioSession.user,
          provider: "verboo-code",
          model: "deepseek-v4-flash",
          requestId: "verboo-request-browser-1",
          candidate: {
            title: "Herói mais ágil",
            explanation: "Candidata da IA isolada para teste no sandbox.",
            risks: ["Pode alterar o ritmo das salas."],
            operations: [
              {
                operationId: "operation-ai-player-speed-1",
                kind: "player.set-tuning",
                explanation: "Aumenta a velocidade dentro do limite permitido.",
                tuning: { speed: 260 },
              },
            ],
          },
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: corsHeaders,
      json: { error: { code: "not_found", message: "Ausente" } },
    });
  });
}

export function studioInvitationUrl(): string {
  return `./?studio=1&studioServer=${encodeURIComponent("https://studio.test")}#invite=${studioInvitation}`;
}
