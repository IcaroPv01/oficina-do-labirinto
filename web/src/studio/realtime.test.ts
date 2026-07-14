import { describe, expect, it } from "vitest";
import {
  createStudioWebSocketUrl,
  parseStudioRealtimeMessage,
  studioReconnectDelay,
} from "./realtime";

describe("realtime do Estúdio", () => {
  it("converte HTTPS em WSS sem colocar credenciais na URL", () => {
    expect(
      createStudioWebSocketUrl(
        new URL("https://studio.example/base/"),
        "project/one",
      ),
    ).toBe("wss://studio.example/base/ws?projectId=project%2Fone");
  });

  it("limita o backoff a trinta segundos", () => {
    expect(studioReconnectDelay(0)).toBe(1_000);
    expect(studioReconnectDelay(3)).toBe(8_000);
    expect(studioReconnectDelay(99)).toBe(30_000);
  });

  it("ignora frames inválidos e preserva eventos tipados", () => {
    expect(parseStudioRealtimeMessage("não-json")).toBeNull();
    expect(parseStudioRealtimeMessage("{}" )).toBeNull();
    expect(
      parseStudioRealtimeMessage(
        JSON.stringify({ type: "chat.created", message: { id: "m1" } }),
      ),
    ).toEqual({ type: "chat.created", message: { id: "m1" } });
  });
});
