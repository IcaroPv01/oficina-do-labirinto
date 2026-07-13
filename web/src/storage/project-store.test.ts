import { describe, expect, it, vi } from "vitest";
import { createAutosaveController } from "./project-store";

describe("createAutosaveController", () => {
  it("consolida alterações rápidas no último valor", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => new Date("2026-07-13T12:00:00Z"));
    const controller = createAutosaveController(save, { delayMilliseconds: 50 });

    controller.schedule({ revision: 1 });
    controller.schedule({ revision: 2 });
    await vi.advanceTimersByTimeAsync(50);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ revision: 2 });
    vi.useRealTimers();
  });

  it("permite forçar a gravação pendente", async () => {
    const save = vi.fn(async () => new Date());
    const controller = createAutosaveController(save, {
      delayMilliseconds: 60_000,
    });

    controller.schedule("projeto");
    await controller.flush();

    expect(save).toHaveBeenCalledWith("projeto");
  });
});
