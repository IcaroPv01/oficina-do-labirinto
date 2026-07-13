import { describe, expect, it } from "vitest";

import { compactHudLabel } from "./hud";

describe("compactHudLabel", () => {
  it("preserva textos curtos e limita textos longos com reticências", () => {
    expect(compactHudLabel("CRIPTA", 10)).toBe("CRIPTA");
    expect(compactHudLabel("LABIRINTO-COM-NOME-MUITO-LONGO", 12)).toBe(
      "LABIRINTO-C…",
    );
  });
});
