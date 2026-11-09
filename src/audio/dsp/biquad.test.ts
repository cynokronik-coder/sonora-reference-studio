import { describe, expect, it } from 'vitest';
import { Biquad, designBiquad } from './biquad';

describe('Biquad coefficient transitions', () => {
  it('ramps stable coefficients over the requested sample count', () => {
    const filter = new Biquad();
    const initial = designBiquad('lowpass', 800, 0, 0.707, 48_000);
    const target = designBiquad('peak', 8_000, 9, 2.5, 48_000);
    filter.set(initial);
    filter.setSmoothed(target, 100);

    const buffer = new Float32Array(40);
    filter.processBlock(buffer, buffer.length);
    expect(filter.isSmoothing).toBe(true);
    expect(filter.b0).not.toBeCloseTo(target.b0, 8);

    const remainder = new Float32Array(60);
    filter.processBlock(remainder, remainder.length);
    expect(filter.isSmoothing).toBe(false);
    expect(filter.b0).toBeCloseTo(target.b0, 12);
    expect(filter.b1).toBeCloseTo(target.b1, 12);
    expect(filter.b2).toBeCloseTo(target.b2, 12);
    expect(filter.a1).toBeCloseTo(target.a1, 12);
    expect(filter.a2).toBeCloseTo(target.a2, 12);
  });

  it('keeps interpolated filter output finite during a high-Q frequency and gain transition', () => {
    const filter = new Biquad();
    filter.set(designBiquad('peak', 120, 0, 1, 48_000));
    const first = new Float32Array(512);
    for (let i = 0; i < first.length; i++) first[i] = 0.7 * Math.sin((2 * Math.PI * 120 * i) / 48_000);
    filter.processBlock(first, first.length);

    filter.setSmoothed(designBiquad('peak', 12_000, 18, 18, 48_000), 960);
    let maxAbs = 0;
    for (let block = 0; block < 4; block++) {
      const audio = new Float32Array(256);
      for (let i = 0; i < audio.length; i++) {
        audio[i] = 0.7 * Math.sin((2 * Math.PI * 12_000 * (512 + block * 256 + i)) / 48_000);
      }
      filter.processBlock(audio, audio.length);
      for (const sample of audio) {
        expect(Number.isFinite(sample)).toBe(true);
        maxAbs = Math.max(maxAbs, Math.abs(sample));
      }
    }
    expect(maxAbs).toBeLessThan(4);
    expect(filter.isSmoothing).toBe(false);
  });

  it('allows an immediate set and reset to cancel an active ramp', () => {
    const filter = new Biquad();
    const target = designBiquad('highpass', 90, 0, 0.707, 48_000);
    filter.setSmoothed(target, 500);
    expect(filter.isSmoothing).toBe(true);
    filter.set(target);
    expect(filter.isSmoothing).toBe(false);
    expect(filter.a1).toBeCloseTo(target.a1, 12);

    filter.setSmoothed(designBiquad('lowpass', 12_000, 0, 0.707, 48_000), 500);
    filter.reset();
    expect(filter.isSmoothing).toBe(false);
  });
});
