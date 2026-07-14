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
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.authorization, "Bearer test-server-only-key");
    const body = requests[1]?.body as { stream: boolean; messages: Array<{ role: string; content: string }> };
    assert.equal(body.stream, false);
    assert.equal(body.messages[0]?.role, "system");
    assert.match(body.messages[0]?.content ?? "", /não pode aplicar, promover ou publicar/);
  } finally {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});
