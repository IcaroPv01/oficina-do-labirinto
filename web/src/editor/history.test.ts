import { describe, expect, it, vi } from "vitest";
import { EditorHistory } from "./history";

describe("EditorHistory", () => {
  it("desfaz e refaz revisões sem expor referências mutáveis", () => {
    const history = new EditorHistory({ name: "Original", nested: { value: 1 } });

    history.push({ name: "Nova", nested: { value: 2 } });
    const undone = history.undo();
    undone.present.nested.value = 99;

    expect(history.snapshot.present).toEqual({
      name: "Original",
      nested: { value: 1 },
    });
    expect(history.redo().present.name).toBe("Nova");
  });

  it("descarta o futuro ao criar uma revisão depois de desfazer", () => {
    const history = new EditorHistory(1);
    history.push(2);
    history.push(3);
    history.undo();
    history.push(4);

    expect(history.snapshot.canRedo).toBe(false);
    expect(history.redo().present).toBe(4);
  });

  it("respeita o limite de revisões", () => {
    const history = new EditorHistory(0, 2);
    history.push(1);
    history.push(2);
    history.push(3);

    expect(history.undo().present).toBe(2);
    expect(history.undo().present).toBe(1);
    expect(history.undo().present).toBe(1);
  });

  it("permite preservar um payload grande com uma estratégia de clone", () => {
    const immutableSkin = Object.freeze({
      dataUrl: `data:image/png;base64,${"A".repeat(250_000)}`,
    });
    const clone = vi.fn(
      (revision: { name: string; skin: typeof immutableSkin; mutable: { value: number } }) => ({
        ...revision,
        skin: revision.skin,
        mutable: { ...revision.mutable },
      }),
    );
    const history = new EditorHistory(
      { name: "Original", skin: immutableSkin, mutable: { value: 1 } },
      10,
      clone,
    );

    history.push({ name: "Nova", skin: immutableSkin, mutable: { value: 2 } });
    const undone = history.undo();
    undone.present.mutable.value = 99;

    const snapshot = history.snapshot;
    expect(snapshot.present.skin).toBe(immutableSkin);
    expect(snapshot.present.mutable.value).toBe(1);
    expect(clone).toHaveBeenCalled();
  });
});
