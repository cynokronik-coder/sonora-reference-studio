import { describe, expect, it } from 'vitest';
import { loudnessMatchedMonitorGain } from './ab';

describe('loudnessMatchedMonitorGain', () => {
  const slots = [
    { id: 'A', lufs: -16 },
    { id: 'B', lufs: -12 },
    { id: 'C', lufs: -14 },
  ];

  it('uses the quietest measured slot as a stable shared reference', () => {
    expect(loudnessMatchedMonitorGain(slots, 'A')).toBe(0);
    expect(loudnessMatchedMonitorGain(slots, 'B')).toBe(-4);
    expect(loudnessMatchedMonitorGain(slots, 'C')).toBe(-2);
  });

  it('never boosts a quieter version', () => {
    expect(loudnessMatchedMonitorGain([
      { id: 'A', lufs: -18 },
      { id: 'B', lufs: -12 },
    ], 'A')).toBe(0);
  });

  it('returns zero for missing or unmeasured slots', () => {
    expect(loudnessMatchedMonitorGain(slots, 'missing')).toBe(0);
    expect(loudnessMatchedMonitorGain([
      { id: 'A', lufs: null },
      { id: 'B', lufs: Number.NEGATIVE_INFINITY },
    ], 'A')).toBe(0);
  });

  it('caps attenuation to protect comfortable monitor level', () => {
    expect(loudnessMatchedMonitorGain([
      { id: 'A', lufs: -24 },
      { id: 'B', lufs: -4 },
    ], 'B', 8)).toBe(-8);
  });

  it('returns zero when no finite measurements exist', () => {
    expect(loudnessMatchedMonitorGain([
      { id: 'A', lufs: Number.NaN },
      { id: 'B', lufs: null },
    ], 'A')).toBe(0);
  });
});
