import { type DBSchema, type IDBPDatabase, openDB } from "idb";

interface StoredProject {
  key: string;
  project: unknown;
  updatedAt: string;
}

interface EditorDatabase extends DBSchema {
  projects: {
    key: string;
    value: StoredProject;
  };
}

const DATABASE_NAME = "jogo-colaborativo-editor";
const DATABASE_VERSION = 1;
const LEGACY_AUTOSAVE_KEY = "current-project";

function normalizeBasePath(basePath: string): string {
  let pathname = basePath.trim().replaceAll("\\", "/");
  try {
    pathname = new URL(pathname || "/", "https://jogo.local").pathname;
  } catch {
    pathname = "/";
  }

  const segments = pathname.split("/").filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

/** Keeps autosaves from different GitHub Pages repositories isolated by base path. */
export function createAutosaveKey(basePath: string): string {
  return `${LEGACY_AUTOSAVE_KEY}:${encodeURIComponent(normalizeBasePath(basePath))}`;
}

const APPLICATION_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
const AUTOSAVE_KEY = createAutosaveKey(APPLICATION_BASE_PATH);

let databasePromise: Promise<IDBPDatabase<EditorDatabase>> | undefined;

function openEditorDatabase(): Promise<IDBPDatabase<EditorDatabase>> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(
      new Error("Este navegador não oferece armazenamento local IndexedDB."),
    );
  }

  databasePromise ??= openDB<EditorDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("projects")) {
        database.createObjectStore("projects", { keyPath: "key" });
      }
    },
  });

  return databasePromise;
}

export interface StoredProjectResult<T> {
  readonly project: T;
  readonly updatedAt: Date;
}

export async function loadAutosave<T>(): Promise<StoredProjectResult<T> | null> {
  const database = await openEditorDatabase();
  let stored = await database.get("projects", AUTOSAVE_KEY);

  // The original prototype used a global key. Migrate it only at the root base;
  // copying it into every Pages repository would recreate the collision.
  if (!stored && APPLICATION_BASE_PATH === "/") {
    const legacy = await database.get("projects", LEGACY_AUTOSAVE_KEY);
    if (legacy) {
      stored = { ...legacy, key: AUTOSAVE_KEY };
      await database.put("projects", stored);
    }
  }

  if (!stored) {
    return null;
  }

  const updatedAt = parseStoredDate(stored.updatedAt);
  return {
    project: structuredClone(stored.project) as T,
    updatedAt,
  };
}

function parseStoredDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new Error("O autosave local contém uma data de atualização inválida.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error("O autosave local contém uma data de atualização inválida.");
  }
  return date;
}

export async function saveAutosave<T>(project: T): Promise<Date> {
  const database = await openEditorDatabase();
  const savedAt = new Date();

  await database.put("projects", {
    key: AUTOSAVE_KEY,
    project: structuredClone(project),
    updatedAt: savedAt.toISOString(),
  });

  return savedAt;
}

export async function clearAutosave(): Promise<void> {
  const database = await openEditorDatabase();
  await database.delete("projects", AUTOSAVE_KEY);
}

export interface AutosaveController<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AutosaveControllerOptions {
  readonly delayMilliseconds?: number;
  readonly onSaved?: (savedAt: Date) => void;
  readonly onError?: (error: Error) => void;
}

/** Debounces frequent editor changes while still allowing a final flush. */
export function createAutosaveController<T>(
  save: (value: T) => Promise<Date>,
  options: AutosaveControllerOptions = {},
): AutosaveController<T> {
  const delay = options.delayMilliseconds ?? 500;
  let pendingValue: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeSave: Promise<void> = Promise.resolve();

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (pendingValue === undefined) {
      await activeSave;
      return;
    }

    const value = pendingValue;
    pendingValue = undefined;
    activeSave = activeSave.then(async () => {
      try {
        const savedAt = await save(value);
        options.onSaved?.(savedAt);
      } catch (cause: unknown) {
        options.onError?.(
          cause instanceof Error
            ? cause
            : new Error("Não foi possível salvar o projeto localmente."),
        );
      }
    });
    await activeSave;
  };

  return {
    schedule(value) {
      pendingValue = structuredClone(value);

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        void flush();
      }, delay);
    },
    flush,
    async dispose() {
      await flush();
    },
  };
}
