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
  });

  it("tem navegação por vista, preview em paisagem e movimento reduzido", () => {
    expect(css).toContain('[data-layout="mobile"]');
    expect(css).toContain('[data-mobile-view="sandbox"]');
    expect(css).toContain("orientation: landscape");
    expect(css).toContain("aspect-ratio: 16 / 9");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
