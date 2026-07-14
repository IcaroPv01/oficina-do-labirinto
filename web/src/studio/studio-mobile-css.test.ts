import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./studio.css", import.meta.url), "utf8");

describe("layout móvel do Estúdio", () => {
  it("inclui toque, áreas seguras, viewport dinâmica e proteção contra overflow", () => {
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("100dvh");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("touch-action: none");
    expect(css).toContain("max-width: 20rem");
  });

  it("tem navegação por vista, host jogável em paisagem e movimento reduzido", () => {
    expect(css).toContain('[data-layout="mobile"]');
    expect(css).toContain('[data-mobile-view="sandbox"]');
    expect(css).toContain("orientation: landscape");
    expect(css).toContain(".studio-preview__game-host");
    expect(css).toContain(".studio-preview__viewport");
    expect(css).toMatch(
      /\[data-layout="mobile"\] \.studio-preview__game-host\s*\{[^}]*position:\s*relative[^}]*min-height:\s*clamp\(25rem/s,
    );
    expect(css).toContain("aspect-ratio: 16 / 9");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("delega os controles de toque ao runtime do jogo", () => {
    expect(css).not.toContain(".studio-touch-controls");
    expect(css).not.toContain(".studio-touch-button");
  });

  it("mantém os modos e ações da proposta de IA dentro da tela estreita", () => {
    expect(css).toContain(".studio-assistant-modes");
    expect(css).toContain(".studio-assistant-proposal__actions");
    expect(css).toMatch(
      /\.studio-assistant-proposal__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.studio-assistant-proposal__actions button\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*44px/s,
    );
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toMatch(
      /\.studio-assistant\[data-assistant-mode="propose"\][\s\S]*?\.studio-composer\s*\{[^}]*position:\s*static/,
    );
  });
});
