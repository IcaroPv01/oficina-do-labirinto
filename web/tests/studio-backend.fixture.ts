import type { Page } from "@playwright/test";
import defaultProject from "../../game-data/default-project.json" with { type: "json" };

export const studioInvitation =
  "invite-token-with-at-least-twenty-characters";

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

/** Installs the smallest browser-level backend needed to exercise the gateway. */
export async function installStudioBackendMock(page: Page): Promise<void> {
  let authenticated = false;
  await page.route("https://studio.test/**", async (route) => {
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
    if (url.pathname === "/auth/me" && !authenticated) {
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
      return;
    }
    if (url.pathname === "/auth/invites/redeem") {
      authenticated = true;
      await route.fulfill({ status: 200, headers: corsHeaders, json: studioSession });
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
    if (url.pathname.endsWith("/change-sets")) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { changeSets: [] },
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
