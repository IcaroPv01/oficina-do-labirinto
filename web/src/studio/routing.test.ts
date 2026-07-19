import { describe, expect, it } from "vitest";
import {
  bootstrapPublicPagesUrl,
  bootstrapPublicStudioServerUrl,
  configuredStudioServerUrl,
  createStudioInviteUrl,
  DEFAULT_LOCAL_STUDIO_SERVER_URL,
  editorUrlFromStudio,
  inviteTokenFromUrl,
  isStudioRoute,
  urlWithoutInviteToken,
} from "./routing";

describe("roteamento do Estúdio", () => {
  it("entra somente com studio=1 e volta sem parâmetros sensíveis", () => {
    const url = new URL(
      "https://example.test/game/?studio=1&seed=one&studioServer=http%3A%2F%2F127.0.0.1%3A8787&publicStudioServer=https%3A%2F%2Ftunnel.example&publicPagesUrl=https%3A%2F%2Fowner.github.io%2Fgame%2F#invite=secret",
    );
    expect(isStudioRoute(url)).toBe(true);
    expect(editorUrlFromStudio(url)).toBe(
      "https://example.test/game/?seed=one",
    );
  });

  it("lê convite somente do fragmento e remove o token sem navegação", () => {
    const url = new URL("https://example.test/?studio=1#invite=once&view=join");
    expect(inviteTokenFromUrl(url)).toBe("once");
    expect(urlWithoutInviteToken(url).hash).toBe("#view=join");
    expect(
      inviteTokenFromUrl(
        new URL("https://example.test/?studio=1&invite=query-leak"),
      ),
    ).toBeNull();
  });

  it("descobre o servidor doméstico local sem etapa de configuração", () => {
    const storage = memoryStorage();
    expect(
      configuredStudioServerUrl(
        new URL("http://localhost:5173/?studio=1"),
        storage,
        undefined,
      ),
    ).toBe(DEFAULT_LOCAL_STUDIO_SERVER_URL);
    expect(
      configuredStudioServerUrl(
        new URL("https://pages.example/game/?studio=1"),
        storage,
        undefined,
      ),
    ).toBeNull();
  });

  it("separa conexão loopback dos endereços públicos usados pelo convite", () => {
    const storage = memoryStorage();
    const ownerUrl = new URL("http://localhost:5173/?studio=1");
    ownerUrl.searchParams.set("studioServer", "http://127.0.0.1:8787");
    ownerUrl.searchParams.set(
      "publicStudioServer",
      "https://tunnel.example/",
    );
    ownerUrl.searchParams.set(
      "publicPagesUrl",
      "https://icaropv01.github.io/oficina-do-labirinto/",
    );

    expect(configuredStudioServerUrl(ownerUrl, storage, undefined)).toBe(
      "http://127.0.0.1:8787",
    );
    expect(bootstrapPublicStudioServerUrl(ownerUrl)).toBe(
      "https://tunnel.example/",
    );
    expect(bootstrapPublicPagesUrl(ownerUrl)?.toString()).toBe(
      "https://icaropv01.github.io/oficina-do-labirinto/",
    );

    const remoteWithoutStudioServer = new URL(
      "https://owner.github.io/game/?publicStudioServer=https%3A%2F%2Ftunnel.example",
    );
    expect(
      configuredStudioServerUrl(
        remoteWithoutStudioServer,
        memoryStorage(),
        undefined,
      ),
    ).toBeNull();
  });

  it("cria link Pages com servidor público e token somente no fragmento", () => {
    const pagesBase = new URL("https://owner.github.io/game/?seed=one");
    pagesBase.searchParams.set("publicStudioServer", "https://stale.example");
    pagesBase.searchParams.set("publicPagesUrl", "https://stale-pages.example");
    const invitation = createStudioInviteUrl(
      pagesBase,
      "https://studio.example/",
      "inv_token_once",
    );
    const parsed = new URL(invitation);
    expect(parsed.searchParams.get("studio")).toBe("1");
    expect(parsed.searchParams.get("studioServer")).toBe(
      "https://studio.example/",
    );
    expect(parsed.searchParams.get("invite")).toBeNull();
    expect(parsed.searchParams.get("publicStudioServer")).toBeNull();
    expect(parsed.searchParams.get("publicPagesUrl")).toBeNull();
    expect(parsed.hash).toBe("#invite=inv_token_once");
    expect(invitation.slice(0, invitation.indexOf("#"))).not.toContain(
      "inv_token_once",
    );
  });

  it("recusa bootstrap público com HTTP remoto ou credenciais", () => {
    const httpServer = new URL("http://localhost:5173/");
    httpServer.searchParams.set(
      "publicStudioServer",
      "http://tunnel.example/",
    );
    expect(() => bootstrapPublicStudioServerUrl(httpServer)).toThrow(/HTTPS/i);

    const credentialedServer = new URL("http://localhost:5173/");
    credentialedServer.searchParams.set(
      "publicStudioServer",
      "https://user:pass@tunnel.example/",
    );
    expect(() => bootstrapPublicStudioServerUrl(credentialedServer)).toThrow(
      /credenciais/i,
    );

    const credentialedPages = new URL("http://localhost:5173/");
    credentialedPages.searchParams.set(
      "publicPagesUrl",
      "https://user:pass@owner.github.io/game/",
    );
    expect(() => bootstrapPublicPagesUrl(credentialedPages)).toThrow(
      /credenciais/i,
    );
    expect(() =>
      createStudioInviteUrl(
        new URL("http://owner.github.io/game/"),
        "https://studio.example/",
        "inv_token_once",
      ),
    ).toThrow(/HTTPS/i);
    expect(() =>
      createStudioInviteUrl(
        new URL("https://owner.github.io/game/"),
        "https://user:pass@studio.example/",
        "inv_token_once",
      ),
    ).toThrow(/credenciais/i);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
