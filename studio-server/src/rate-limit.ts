import { HttpError } from "./errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly label: string,
  ) {}

  assertAllowed(key: string): void {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > 10_000) this.sweep(now);
      return;
    }
    existing.count += 1;
    if (existing.count > this.limit) {
      const seconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1_000));
      throw new HttpError(429, "rate_limited", `${this.label}; tente novamente em ${seconds}s`);
    }
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export class ConcurrencyGate {
  private readonly active = new Set<string>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.active.has(key)) {
      throw new HttpError(429, "ai_already_running", "Já existe uma solicitação de IA em andamento");
    }
    this.active.add(key);
    try {
      return await operation();
    } finally {
      this.active.delete(key);
    }
  }
}
