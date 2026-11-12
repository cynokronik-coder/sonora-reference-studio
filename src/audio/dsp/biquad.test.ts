import { describe, expect, it } from 'vitest';
import { Biquad, designBiquad } from './biquad';

describe('Biquad coefficient transitions', () => {
  it('reaches the target coefficients after the requested sample count', () => {
    const filter = new Biquad();
    const initial = designBiquad('lowpass', 800, 0, 0.707, 48_000);
    const target = designBiquad('peak', 8_000, 9, 2.5, 48_000);
    filter.set(initial);
    filter.setSmoothed(target, 100);

    filter.processBlock(new Float32Array(40), 40);
    expect(filter.isSmoothing).toBe(true);
    expect(filter.b0).not.toBeCloseTo(target.b0, 8);

    filter.processBlock(new Float32Array(60), 60);
    expect(filter.isSmoothing).toBe(false);
    expect(filter.b0).toBe(target.b0);
    expect(filter.b1).toBe(target.b1);
    expect(filter.b2).toBe(target.b2);
    expect(filter.a1).toBe(target.a1);
    expect(filter.a2).toBe(target.a2);
  });

  it('keeps output finite during a high-Q frequency and gain transition', () => {
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
});
