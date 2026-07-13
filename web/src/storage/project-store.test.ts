import { openDB } from "idb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutosaveController,
  createAutosaveKey,
  loadAutosave,
} from "./project-store";

vi.mock("idb", () => ({ openDB: vi.fn() }));

const getStoredProject = vi.fn();
const putStoredProject = vi.fn();

describe("createAutosaveKey", () => {
  it("isola projetos hospedados em caminhos diferentes", () => {
    expect(createAutosaveKey("/")).not.toBe(
      createAutosaveKey("/oficina-labirinto/"),
    );
    expect(createAutosaveKey("/oficina-labirinto")).toBe(
      createAutosaveKey("https://example.test/oficina-labirinto/"),
    );
  });
});

describe("loadAutosave", () => {
  beforeAll(() => {
    vi.stubGlobal("indexedDB", {});
    vi.mocked(openDB).mockResolvedValue({
      get: getStoredProject,
      put: putStoredProject,
    } as never);
  });

  beforeEach(() => {
    getStoredProject.mockReset();
    putStoredProject.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("carrega um timestamp ISO persistido", async () => {
    getStoredProject.mockResolvedValueOnce({
      key: "current-project",
      project: { name: "Cripta" },
      updatedAt: "2026-07-13T12:00:00.000Z",
    });

    await expect(loadAutosave<{ name: string }>()).resolves.toEqual({
      project: { name: "Cripta" },
      updatedAt: new Date("2026-07-13T12:00:00.000Z"),
    });
  });

  it("rejeita updatedAt inválido antes de entregá-lo à interface", async () => {
    getStoredProject.mockResolvedValueOnce({
      key: "current-project",
      project: { name: "Corrompido" },
      updatedAt: "data-inválida",
    });

    await expect(loadAutosave()).rejects.toThrow(/data de atualização inválida/i);
  });

  it("migra o autosave legado apenas para a chave isolada da raiz", async () => {
    getStoredProject
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        key: "current-project",
        project: { name: "Legado" },
        updatedAt: "2026-07-13T12:00:00.000Z",
      });

    await expect(loadAutosave<{ name: string }>()).resolves.toEqual({
      project: { name: "Legado" },
      updatedAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(putStoredProject).toHaveBeenCalledWith(
      "projects",
      expect.objectContaining({
        key: createAutosaveKey("/"),
        project: { name: "Legado" },
      }),
    );
  });
});

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
