import { describe, expect, it } from "vitest";
import {
  createStudioFetchTransport,
  createStudioServerApiClient,
  normalizeStudioServerUrl,
  type StudioTransport,
  type StudioTransportRequest,
} from "./api-client";
import { studioDraftChangeSet } from "./studio-test-fixtures";

describe("normalizeStudioServerUrl", () => {
  it("aceita HTTPS e HTTP somente em loopback", () => {
    expect(normalizeStudioServerUrl("https://studio.example/").origin).toBe(
      "https://studio.example",
    );
    expect(normalizeStudioServerUrl("http://127.0.0.1:8787").port).toBe("8787");
    expect(() => normalizeStudioServerUrl("http://studio.example")).toThrow(
      /HTTPS/i,
    );
    expect(() => normalizeStudioServerUrl("https://user:pass@studio.example"))
      .toThrow(/credenciais/i);
  });
});

describe("createStudioFetchTransport", () => {
  it("usa cookie HttpOnly e injeta CSRF somente em mutações marcadas", async () => {
    const calls: { readonly input: RequestInfo | URL; readonly init?: RequestInit }[] = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const transport = createStudioFetchTransport({
      baseUrl: "https://studio.example",
      fetchImplementation,
    });
    transport.setCsrfToken("csrf-memory-only");

    await transport.send({
      method: "POST",
      path: "/api/projects",
      body: { name: "Oficina" },
      requiresCsrf: true,
    });

    const init = calls[0]?.init;
    expect(init).toBeDefined();
    if (!init) {
      throw new Error("A chamada fetch não foi registrada.");
    }
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-Studio-CSRF")).toBe(
      "csrf-memory-only",
    );
    expect(JSON.stringify(init)).not.toMatch(/authorization|bearer|api[_-]?key/i);
  });

  it("bloqueia mutação sem CSRF antes da rede", async () => {
    let called = false;
    const fetchImplementation: typeof fetch = async () => {
      called = true;
      return new Response();
    };
    const transport = createStudioFetchTransport({
      baseUrl: "https://studio.example",
      fetchImplementation,
    });

    await expect(
      transport.send({
        method: "POST",
        path: "/api/projects",
        body: {},
        requiresCsrf: true,
      }),
    ).rejects.toMatchObject({
      code: "csrf_unavailable",
    });
    expect(called).toBe(false);
  });
});

describe("createStudioServerApiClient", () => {
  it("alinha snapshot, chat e IA às rotas reais do servidor", async () => {
    const requests: StudioTransportRequest[] = [];
    const transport = mockTransport(requests);
    const client = createStudioServerApiClient(transport);

    await client.getProjectSnapshot("projeto/um");
    await client.updateProjectSnapshot(
      "projeto/um",
      7,
      { name: "Labirinto" },
      "Ajustei o nome do projeto.",
    );
    await client.sendChat("projeto/um", "Olá");
    await client.advisoryChat(
      [{ role: "user", content: "Explique o mob" }],
      "deepseek-v4-flash",
    );

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/api/projects/projeto%2Fum/snapshot",
      },
      {
        method: "PUT",
        path: "/api/projects/projeto%2Fum/snapshot",
        body: {
          baseRevision: 7,
          snapshot: { name: "Labirinto" },
          explanation: "Ajustei o nome do projeto.",
        },
        requiresCsrf: true,
      },
      {
        method: "POST",
        path: "/api/projects/projeto%2Fum/chat",
        body: { body: "Olá" },
        requiresCsrf: true,
      },
      {
        method: "POST",
        path: "/api/ai/chat",
        body: {
          messages: [{ role: "user", content: "Explique o mob" }],
          model: "deepseek-v4-flash",
        },
        requiresCsrf: true,
      },
    ]);
  });

  it("nunca envia aprovação sem digest explícito", async () => {
    const requests: StudioTransportRequest[] = [];
    const client = createStudioServerApiClient(mockTransport(requests));

    await client.reviewChangeSet("project", "change", {
      decision: "approve",
      revisionId: "revision-1",
      revisionDigest: "a".repeat(64),
      explanation: "Testado no sandbox.",
    });

    expect(requests[0]).toMatchObject({
      path: "/api/projects/project/change-sets/change/review",
      requiresCsrf: true,
      body: expect.objectContaining({
        revisionId: "revision-1",
        revisionDigest: "a".repeat(64),
      }),
    });
  });

  it("rejeita proposta HTTP que não cumpre o contrato compartilhado", async () => {
    const transport: StudioTransport = {
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(): Promise<Response> {
        return { changeSets: [{ kind: "code.run" }] } as Response;
      },
    };
    const client = createStudioServerApiClient(transport);

    await expect(client.listChangeSets("project-main")).rejects.toMatchObject({
      code: "invalid_change_set_response",
    });
  });
});

function mockTransport(requests: StudioTransportRequest[]): StudioTransport {
  return {
    baseUrl: new URL("https://studio.example"),
    setCsrfToken() {},
    async send<Response>(request: StudioTransportRequest): Promise<Response> {
      requests.push(request);
      if (request.path.endsWith("/chat") && request.method === "POST") {
        return { message: {} } as Response;
      }
      if (request.path === "/api/ai/chat") {
        return { mode: "advisory", applied: false, reply: {} } as Response;
      }
      if (request.path.endsWith("/review")) {
        return { changeSet: studioDraftChangeSet() } as Response;
      }
      return {} as Response;
    },
  };
}
