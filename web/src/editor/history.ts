export interface HistorySnapshot<T> {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * Immutable undo/redo history. Values are cloned at the boundary so callers
 * cannot accidentally mutate a past revision.
 */
export class EditorHistory<T> {
  readonly #limit: number;
  #past: T[] = [];
  #present: T;
  #future: T[] = [];

  constructor(initialValue: T, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("O limite do histórico deve ser um inteiro positivo.");
    }

    this.#limit = limit;
    this.#present = structuredClone(initialValue);
  }

  get snapshot(): HistorySnapshot<T> {
    return {
      present: structuredClone(this.#present),
      canUndo: this.#past.length > 0,
      canRedo: this.#future.length > 0,
    };
  }

  push(nextValue: T): HistorySnapshot<T> {
    this.#past.push(structuredClone(this.#present));

    if (this.#past.length > this.#limit) {
      this.#past.shift();
    }

    this.#present = structuredClone(nextValue);
    this.#future = [];
    return this.snapshot;
  }

  replace(nextValue: T): HistorySnapshot<T> {
    this.#present = structuredClone(nextValue);
    return this.snapshot;
  }

  reset(nextValue: T): HistorySnapshot<T> {
    this.#past = [];
    this.#future = [];
    this.#present = structuredClone(nextValue);
    return this.snapshot;
  }

  undo(): HistorySnapshot<T> {
    const previous = this.#past.pop();

    if (previous === undefined) {
      return this.snapshot;
    }

    this.#future.push(structuredClone(this.#present));
    this.#present = previous;
    return this.snapshot;
  }

  redo(): HistorySnapshot<T> {
    const next = this.#future.pop();

    if (next === undefined) {
      return this.snapshot;
    }

    this.#past.push(structuredClone(this.#present));
    this.#present = next;
    return this.snapshot;
  }
}
