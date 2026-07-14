import { describe, expect, it } from "vitest";
import {
  editorUrlFromStudio,
  inviteTokenFromUrl,
  isStudioRoute,
  urlWithoutInviteToken,
} from "./routing";

describe("roteamento do Estúdio", () => {
  it("entra somente com studio=1 e volta sem parâmetros sensíveis", () => {
    const url = new URL(
      "https://example.test/game/?studio=1&seed=one#invite=secret",
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
});
