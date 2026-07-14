import { describe, expect, it } from "vitest";
import {
  createStudioFetchTransport,
  createStudioServerApiClient,
  normalizeStudioServerUrl,
  StudioApiError,
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

  it("transforma um candidato aceito em rascunho e depois o marca para teste", async () => {
    const requests: StudioTransportRequest[] = [];
    const draft = studioDraftChangeSet();
    const proposed = {
      ...draft,
      status: "proposed" as const,
      candidateRevision: {
        ...draft.baseRevision,
        revisionId: "candidate-ready-1",
        parentRevisionId: draft.baseRevision.revisionId,
        sequence: draft.baseRevision.sequence + 1,
        digest: "d".repeat(64),
      },
      operations: [
        {
          operationId: "operation-ready-speed",
          kind: "player.set-tuning" as const,
          explanation: "Aumenta a velocidade dentro do limite.",
          tuning: { speed: 240 },
        },
      ],
    };
    const client = createStudioServerApiClient({
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(request: StudioTransportRequest): Promise<Response> {
        requests.push(request);
        return {
          changeSet: request.path.endsWith("/ready") ? proposed : draft,
        } as Response;
      },
    });
    const input = {
      title: "Herói mais rápido",
      explanation: "Candidato aceito pelo usuário, ainda não aplicado.",
      operations: proposed.operations,
    };

    await client.createChangeSet("project-main", input);
    await client.markChangeSetReady(
      "project-main",
      draft.changeSetId,
      "Pronta para o sandbox.",
    );

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/projects/project-main/change-sets",
        body: input,
        requiresCsrf: true,
      },
      {
        method: "POST",
        path: `/api/projects/project-main/change-sets/${draft.changeSetId}/ready`,
        body: { explanation: "Pronta para o sandbox." },
        requiresCsrf: true,
      },
    ]);
  });

  it("coloca a proposta em teste e registra evidência para a revisão exata", async () => {
    const requests: StudioTransportRequest[] = [];
    const candidate = testingChangeSet();
    const transport: StudioTransport = {
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(request: StudioTransportRequest): Promise<Response> {
        requests.push(request);
        if (request.path.endsWith("/testing")) {
          return { changeSet: candidate } as Response;
        }
        const input = request.body as {
          revisionId: string;
          revisionDigest: string;
          status: "passed";
          checks: readonly [{ readonly name: string; readonly status: "passed"; readonly details: null }];
          startedAt: string;
          completedAt: string;
        };
        return {
          changeSet: testingChangeSet({
            testRunId: "test-run-001",
            revisionId: input.revisionId,
            revisionDigest: input.revisionDigest,
            status: input.status,
            checks: [
              {
                checkId: "check-movement",
                name: input.checks[0].name,
                status: input.checks[0].status,
                details: input.checks[0].details,
              },
            ],
            executedBy: candidate.author,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
          }),
        } as Response;
      },
    };
    const client = createStudioServerApiClient(transport);
    const revision = candidate.candidateRevision;
    if (!revision) throw new Error("Fixture sem revisão candidata.");
    const testInput = {
      revisionId: revision.revisionId,
      revisionDigest: revision.digest,
      status: "passed" as const,
      checks: [{ name: "Movimento e colisão", status: "passed" as const, details: null }],
      startedAt: "2026-07-13T12:01:00.000Z",
      completedAt: "2026-07-13T12:01:01.000Z",
    };

    await client.markChangeSetTesting("project/main", "change/main", "Iniciar teste seguro.");
    const updated = await client.recordSandboxTest("project/main", "change/main", testInput);

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/projects/project%2Fmain/change-sets/change%2Fmain/testing",
        body: { explanation: "Iniciar teste seguro." },
        requiresCsrf: true,
      },
      {
        method: "POST",
        path: "/api/projects/project%2Fmain/change-sets/change%2Fmain/tests",
        body: testInput,
        requiresCsrf: true,
      },
    ]);
    expect(updated.latestTest).toMatchObject({
      revisionId: revision.revisionId,
      revisionDigest: revision.digest,
    });
  });

  it("limita checks antes da rede e preserva conflito de revisão do servidor", async () => {
    let calls = 0;
    const conflictTransport: StudioTransport = {
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(): Promise<Response> {
        calls += 1;
        throw new StudioApiError(
          409,
          "candidate_mismatch",
          "A revisão informada não é a candidata atual",
        );
      },
    };
    const client = createStudioServerApiClient(conflictTransport);
    const commonInput = {
      revisionId: "revision-candidate",
      revisionDigest: "b".repeat(64),
      status: "passed" as const,
      startedAt: "2026-07-13T12:01:00.000Z",
      completedAt: "2026-07-13T12:01:01.000Z",
    };

    await expect(
      client.recordSandboxTest("project", "change", {
        ...commonInput,
        checks: Array.from({ length: 65 }, (_, index) => ({
          checkId: `check-${index}`,
          name: `Check ${index}`,
          status: "passed" as const,
          details: null,
        })),
      }),
    ).rejects.toMatchObject({ code: "invalid_sandbox_test_input", status: 400 });
    expect(calls).toBe(0);

    await expect(
      client.recordSandboxTest("project", "change", {
        ...commonInput,
        checks: [{ name: "Movimento", status: "passed", details: null }],
      }),
    ).rejects.toMatchObject({
      code: "candidate_mismatch",
      status: 409,
      message: "A revisão informada não é a candidata atual",
    });
    expect(calls).toBe(1);
  });

  it("rejeita evidência que o servidor vinculou a outra revisão", async () => {
    const client = createStudioServerApiClient({
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(): Promise<Response> {
        const candidate = testingChangeSet();
        const revision = candidate.candidateRevision;
        if (!revision) throw new Error("Fixture sem revisão candidata.");
        return {
          changeSet: testingChangeSet({
            testRunId: "test-run-other",
            revisionId: revision.revisionId,
            revisionDigest: revision.digest,
            status: "passed",
            checks: [{ checkId: "check-other", name: "Outro", status: "passed", details: null }],
            executedBy: candidate.author,
            startedAt: "2026-07-13T12:01:00.000Z",
            completedAt: "2026-07-13T12:01:01.000Z",
          }),
        } as Response;
      },
    });

    await expect(
      client.recordSandboxTest("project", "change", {
        revisionId: "revision-requested",
        revisionDigest: "c".repeat(64),
        status: "passed",
        checks: [{ name: "Movimento", status: "passed", details: null }],
        startedAt: "2026-07-13T12:01:00.000Z",
        completedAt: "2026-07-13T12:01:01.000Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_test_binding_response", status: 502 });
  });

  it("aceita somente candidato de IA estruturado e nunca aplicado", async () => {
    const requests: StudioTransportRequest[] = [];
    const client = createStudioServerApiClient({
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(request: StudioTransportRequest): Promise<Response> {
        requests.push(request);
        return {
          mode: "proposal",
          applied: false,
          proposalId: "ai-proposal-001",
          projectId: "project-main",
          createdAt: "2026-07-13T12:00:00.000Z",
          promptDigest: "a".repeat(64),
          author: { id: "user-owner", displayName: "Owner", role: "owner" },
          provider: "verboo-code",
          model: "model-safe",
          requestId: "request-001",
          candidate: {
            title: "Ajustar velocidade",
            explanation: "Mudança pequena para teste.",
            risks: ["Pode alterar o ritmo do jogo."],
            operations: [
              {
                operationId: "operation-speed",
                kind: "player.set-tuning",
                explanation: "Aumenta a velocidade dentro do limite.",
                tuning: { speed: 220 },
              },
            ],
          },
        } as Response;
      },
    });

    const proposal = await client.proposeChangeWithAi(
      "project-main",
      "Aumente um pouco a velocidade.",
      "model-safe",
    );

    expect(proposal.candidate.operations[0]?.kind).toBe("player.set-tuning");
    expect(proposal.proposalId).toBe("ai-proposal-001");
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/api/ai/propose",
      body: { projectId: "project-main", prompt: "Aumente um pouco a velocidade.", model: "model-safe" },
      requiresCsrf: true,
    });
  });

  it("rejeita operação arbitrária retornada pela IA", async () => {
    const client = createStudioServerApiClient({
      baseUrl: new URL("https://studio.example"),
      setCsrfToken() {},
      async send<Response>(): Promise<Response> {
        return {
          mode: "proposal",
          applied: false,
          proposalId: "ai-proposal-unsafe",
          projectId: "project-main",
          createdAt: "2026-07-13T12:00:00.000Z",
          promptDigest: "b".repeat(64),
          author: { id: "user-owner", displayName: "Owner", role: "owner" },
          provider: "verboo-code",
          model: "model-safe",
          requestId: null,
          candidate: {
            title: "Código livre",
            explanation: "Não pode passar pelo contrato.",
            risks: ["Executaria código arbitrário."],
            operations: [{ operationId: "unsafe-operation", kind: "code.run", script: "doSomething()" }],
          },
        } as Response;
      },
    });

    await expect(client.proposeChangeWithAi("project-main", "Execute código", "model-safe"))
      .rejects.toMatchObject({ code: "invalid_ai_proposal_response", status: 502 });
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

function testingChangeSet(latestTest: unknown = null) {
  const draft = studioDraftChangeSet();
  return {
    ...draft,
    status: "testing" as const,
    candidateRevision: {
      ...draft.baseRevision,
      revisionId: "revision-candidate",
      parentRevisionId: draft.baseRevision.revisionId,
      sequence: 1,
      digest: "b".repeat(64),
      contentBytes: 128,
    },
    operations: [
      {
        operationId: "operation-speed",
        kind: "player.set-tuning" as const,
        explanation: "Ajusta a velocidade dentro do limite.",
        tuning: { speed: 220 },
      },
    ],
    latestTest,
  };
}
