import { describe, expect, it } from "vitest";

import { resolveSiteBase } from "./resolve-site-base";

describe("resolveSiteBase", () => {
  it("usa a raiz no desenvolvimento local", () => {
    expect(resolveSiteBase({})).toBe("/");
  });

  it("usa o nome do repositório em um project site", () => {
    expect(
      resolveSiteBase({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "amigos/oficina-labirinto",
      }),
    ).toBe("/oficina-labirinto/");
  });

  it("usa a raiz em um user site", () => {
    expect(
      resolveSiteBase({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "Amigos/AMIGOS.github.io",
      }),
    ).toBe("/");
  });

  it("permite configurar a raiz de um domínio próprio", () => {
    expect(
      resolveSiteBase({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "amigos/oficina-labirinto",
        VITE_BASE_PATH: "/",
      }),
    ).toBe("/");
    expect(() => resolveSiteBase({ VITE_BASE_PATH: "https://exemplo.test" })).toThrow(
      /iniciado por/i,
    );
  });
});
