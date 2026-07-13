import { describe, expect, it } from "vitest";

import {
  FIXED_STEP_MS,
  MAX_FIXED_SUBSTEPS,
  advanceFixedClock,
} from "./fixedStep";

describe("advanceFixedClock", () => {
  it("carrega a sobra para o próximo frame", () => {
    const first = advanceFixedClock(0, FIXED_STEP_MS * 0.75);
    expect(first.stepCount).toBe(0);

    const second = advanceFixedClock(first.remainderMs, FIXED_STEP_MS * 0.5);
    expect(second.stepCount).toBe(1);
    expect(second.remainderMs).toBeCloseTo(FIXED_STEP_MS * 0.25);
  });

  it("executa exatamente sessenta passos em um segundo estável", () => {
    let remainderMs = 0;
    let steps = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const advanced = advanceFixedClock(remainderMs, FIXED_STEP_MS);
      remainderMs = advanced.remainderMs;
      steps += advanced.stepCount;
    }
    expect(steps).toBe(60);
  });

  it("descarta atraso excessivo em vez de criar espiral de recuperação", () => {
    const advanced = advanceFixedClock(0, 2_000);
    expect(advanced.stepCount).toBe(MAX_FIXED_SUBSTEPS);
    expect(advanced.remainderMs).toBeLessThan(0.001);
  });
});
