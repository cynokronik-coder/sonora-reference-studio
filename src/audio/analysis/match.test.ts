import { describe, expect, it } from 'vitest';
import { estimatePreLimiterTruePeak } from './match';

describe('reference-match pre-limiter peak estimate', () => {
  it('adds a broadband gain change to the measured source true peak', () => {
    expect(estimatePreLimiterTruePeak(-6.2, 2.5)).toBeCloseTo(-3.7, 8);
    expect(estimatePreLimiterTruePeak(-3.1, -1.4)).toBeCloseTo(-4.5, 8);
  });

  it('does not clamp an estimate to the selected limiter ceiling', () => {
    expect(estimatePreLimiterTruePeak(-0.4, 1.2)).toBeCloseTo(0.8, 8);
  });

  it('rejects invalid measurements rather than propagating NaN', () => {
    expect(() => estimatePreLimiterTruePeak(Number.NaN, 1)).toThrow(RangeError);
    expect(() => estimatePreLimiterTruePeak(-1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
