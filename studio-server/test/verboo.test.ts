import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { VerbooClient } from "../src/verboo.js";

test("Verboo client keeps Bearer credentials server-side and forces advisory mode", async () => {
  const requests: Array<{ path: string; authorization: string | undefined; body: unknown }> = [];
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const text = Buffer.concat(chunks).toString("utf8");
    requests.push({
      path: request.url ?? "",
      authorization: request.headers.authorization,
      body: text ? (JSON.parse(text) as unknown) : null,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/router/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "model-one", owned_by: "verboo" }] }));
      return;
    }
    const requestBody = requests.at(-1)?.body as {
      response_format?: unknown;
      messages?: Array<{ role: string; content: string }>;
    };
    if (requestBody.response_format) {
      const unsafe = requestBody.messages?.at(-1)?.content.includes("insegura") ?? false;
      response.end(
        JSON.stringify({
          id: "proposal-1",
          model: "model-one",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  title: unsafe ? "Operação insegura" : "Ajustar velocidade",
                  explanation: unsafe ? "Deve ser rejeitada." : "Mudança pequena para validar no sandbox.",
                  risks: unsafe ? ["Tentativa de código arbitrário."] : ["Pode alterar o ritmo do jogo."],
                  operations: unsafe
                    ? [{ operationId: "unsafe-operation", kind: "code.run", script: "doSomething()" }]
                    : [
                        {
                          operationId: "operation-speed",
                          kind: "player.set-tuning",
                          explanation: "Aumenta a velocidade dentro do limite.",
                          tuning: { speed: 220 },
                        },
                      ],
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        id: "reply-1",
        model: "model-one",
        choices: [{ message: { role: "assistant", content: "Sugestão segura" }, finish_reason: "stop" }],
      }),
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as AddressInfo).port;
  const config = loadConfig({
    STUDIO_CORS_ORIGINS: "http://localhost:5173",
    VERBOO_API_KEY: "test-server-only-key",
    VERBOO_BASE_URL: `http://127.0.0.1:${port}/router/v1`,
    VERBOO_DEFAULT_MODEL: "model-one",
  });

  try {
    const client = new VerbooClient(config);
    assert.deepEqual(await client.listModels(), [{ id: "model-one", ownedBy: "verboo" }]);
    assert.equal((await client.advisoryChat([{ role: "user", content: "Uma ideia" }])).content, "Sugestão segura");
    const generation = await client.proposeChange("Aumente um pouco a velocidade");
    assert.equal(generation.candidate.operations[0]?.kind, "player.set-tuning");
    assert.deepEqual(
      { provider: generation.provider, model: generation.model, requestId: generation.requestId },
      { provider: "verboo", model: "model-one", requestId: "proposal-1" },
    );
    assert.doesNotMatch(JSON.stringify(generation), /test-server-only-key/);
    await assert.rejects(client.proposeChange("Crie uma operação insegura"), {
      status: 502,
      code: "invalid_ai_proposal",
    });

    assert.equal(requests.length, 4);
    assert.equal(requests[0]?.authorization, "Bearer test-server-only-key");
    const body = requests[1]?.body as { stream: boolean; messages: Array<{ role: string; content: string }> };
    assert.equal(body.stream, false);
    assert.equal(body.messages[0]?.role, "system");
    assert.match(body.messages[0]?.content ?? "", /não pode aplicar, promover ou publicar/);
    const proposalBody = requests[2]?.body as {
      stream: boolean;
      response_format: { type: string };
    };
    assert.equal(proposalBody.stream, false);
    assert.equal(proposalBody.response_format.type, "json_object");
    const proposalMessages = (requests[2]?.body as { messages: Array<{ content: string }> }).messages;
    assert.match(proposalMessages[0]?.content ?? "", /Siga exatamente este JSON Schema/);
  } finally {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test("Verboo rejects successful upstream payloads that echo its synthetic credential", async () => {
  const syntheticKey = "synthetic-verboo-key-never-from-env";
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? (JSON.parse(text) as { response_format?: unknown }) : null;
    response.setHeader("content-type", "application/json");

    if (request.url === "/router/v1/models") {
      response.end(JSON.stringify({
        data: [{ id: "model-one", owned_by: "verboo" }],
        metadata: { [syntheticKey]: "even object names are untrusted provider strings" },
      }));
      return;
    }
    if (body?.response_format) {
      response.end(JSON.stringify({
        id: "proposal-safe-id",
        model: "model-one",
        choices: [{
          message: {
            role: "assistant",
            content: JSON.stringify({
              title: "Ajustar velocidade",
              explanation: "Mudança pequena para o sandbox.",
              risks: ["Pode alterar o ritmo do jogo."],
              operations: [{
                operationId: "operation-speed",
                kind: "player.set-tuning",
                explanation: "Aumenta a velocidade dentro do limite.",
                tuning: { speed: 220 },
              }],
            }),
          },
        }],
        debug: { nested: [`provider-prefix-${syntheticKey}-provider-suffix`] },
      }));
      return;
    }
    response.end(JSON.stringify({
      id: "reply-safe-id",
      model: "model-one",
      choices: [{
        message: { role: "assistant", content: `Sugestão insegura: ${syntheticKey}` },
        finish_reason: "stop",
      }],
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as AddressInfo).port;
  const config = loadConfig({
    STUDIO_CORS_ORIGINS: "http://localhost:5173",
    VERBOO_API_KEY: syntheticKey,
    VERBOO_BASE_URL: `http://127.0.0.1:${port}/router/v1`,
    VERBOO_DEFAULT_MODEL: "model-one",
  });
  const client = new VerbooClient(config);

  try {
    await assertSecretEchoRejected(client.listModels(), syntheticKey);
    await assertSecretEchoRejected(
      client.advisoryChat([{ role: "user", content: "Uma ideia" }]),
      syntheticKey,
    );
    await assertSecretEchoRejected(client.proposeChange("Aumente um pouco a velocidade"), syntheticKey);
  } finally {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

async function assertSecretEchoRejected(operation: Promise<unknown>, secret: string): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    const rejected = error as { status?: number; code?: string; message?: string };
    assert.equal(rejected.status, 502);
    assert.equal(rejected.code, "ai_secret_echo");
    assert.equal(rejected.message?.includes(secret), false);
    return true;
  });
}
