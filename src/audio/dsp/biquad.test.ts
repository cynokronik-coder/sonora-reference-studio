import { describe, expect, it } from 'vitest';
import { Biquad, designBiquad } from './biquad';

describe('Biquad coefficient smoothing', () => {
  it('reaches the target coefficients over the requested samples', () => {
    const filter = new Biquad();
    const target = designBiquad('lowpass', 4000, 0, 0.7071, 48000);

    filter.setSmoothed(target, 128);
    for (let i = 0; i < 127; i++) filter.process(0);
    expect(filter.isSmoothing).toBe(true);
    filter.process(0);

    expect(filter.isSmoothing).toBe(false);
    expect(filter.b0).toBe(target.b0);
    expect(filter.b1).toBe(target.b1);
    expect(filter.b2).toBe(target.b2);
    expect(filter.a1).toBe(target.a1);
    expect(filter.a2).toBe(target.a2);
  });

  it('supports smoothed configuration without replacing its scratch coefficient object', () => {
    const filter = new Biquad();
    const first = designBiquad('bandpass', 3000, 0, 8, 48000);
    const second = designBiquad('bandpass', 8000, 0, 12, 48000);

    filter.configureSmoothed('bandpass', 3000, 0, 8, 48000, 64);
    for (let i = 0; i < 64; i++) filter.process(0.25);
    const reached = [filter.b0, filter.b1, filter.b2, filter.a1, filter.a2];
    expect(reached).toEqual([first.b0, first.b1, first.b2, first.a1, first.a2]);

    filter.configureSmoothed('bandpass', 8000, 0, 12, 48000, 64);
    for (let i = 0; i < 64; i++) filter.process(0.25);
    expect([filter.b0, filter.b1, filter.b2, filter.a1, filter.a2]).toEqual([
      second.b0, second.b1, second.b2, second.a1, second.a2,
    ]);
  });

  it('advances coefficient ramps in block processing as well as scalar processing', () => {
    const target = designBiquad('lowpass', 7000, 0, 0.7071, 48000);
    const scalar = new Biquad();
    const block = new Biquad();
    scalar.setSmoothed(target, 96);
    block.setSmoothed(target, 96);
    const blockInput = new Float32Array(128);
    for (let i = 0; i < blockInput.length; i++) blockInput[i] = Math.sin(i * 0.13) * 0.4;

    const scalarOutput = new Float32Array(blockInput.length);
    for (let i = 0; i < blockInput.length; i++) scalarOutput[i] = scalar.process(blockInput[i]);
    block.processBlock(blockInput, blockInput.length);

    for (let i = 0; i < blockInput.length; i++) expect(blockInput[i]).toBeCloseTo(scalarOutput[i], 6);
  });
});
