export const FIXED_STEP_MS = 1000 / 60;
export const MAX_FIXED_SUBSTEPS = 8;

export interface FixedClockAdvance {
  readonly stepCount: number;
  readonly remainderMs: number;
}

export function advanceFixedClock(
  previousRemainderMs: number,
  frameDeltaMs: number,
): FixedClockAdvance {
  const safeRemainder = Number.isFinite(previousRemainderMs)
    ? Math.max(0, previousRemainderMs)
    : 0;
  const safeDelta = Number.isFinite(frameDeltaMs) ? Math.max(0, frameDeltaMs) : 0;
  const maximumBudget = FIXED_STEP_MS * MAX_FIXED_SUBSTEPS;
  const budget = Math.min(maximumBudget, safeRemainder + safeDelta);
  const stepCount = Math.min(
    MAX_FIXED_SUBSTEPS,
    Math.floor((budget + Number.EPSILON * maximumBudget) / FIXED_STEP_MS),
  );
  return {
    stepCount,
    remainderMs: Math.max(0, budget - stepCount * FIXED_STEP_MS),
  };
}
