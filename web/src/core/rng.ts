/** Converts an arbitrary seed into a stable unsigned 32-bit state. */
export function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0 || 0x6d2b79f5;
}

export interface RandomResult {
  readonly value: number;
  readonly state: number;
}

/** Mulberry32 step expressed without hidden mutable global state. */
export function nextRandom(state: number): RandomResult {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
    state: nextState,
  };
}

export function createSeededRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    const result = nextRandom(state);
    state = result.state;
    return result.value;
  };
}

