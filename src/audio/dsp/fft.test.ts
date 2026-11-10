import { describe, expect, it } from 'vitest';
import { FFT, hannWindow } from './fft';

describe('FFT plans and cached windows', () => {
  it.each([2, 8, 64, 1_024, 4_096])('round-trips complex samples for size %i', (size) => {
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      real[i] = Math.sin(i * 0.071) * 0.7 + Math.cos(i * 0.013) * 0.2;
      imag[i] = Math.cos(i * 0.037) * 0.15;
    }
    const expectedReal = real.slice();
    const expectedImag = imag.slice();

    const fft = new FFT(size);
    fft.forward(real, imag);
    fft.inverse(real, imag);

    for (let i = 0; i < size; i++) {
      expect(real[i]).toBeCloseTo(expectedReal[i], 9);
      expect(imag[i]).toBeCloseTo(expectedImag[i], 9);
    }
  });

  it('allows multiple FFT instances to share a plan without sharing transform state', () => {
    const size = 2_048;
    const inputA = Float64Array.from({ length: size }, (_, i) => Math.sin(i * 0.02));
    const inputB = Float64Array.from({ length: size }, (_, i) => Math.cos(i * 0.031));
    const originalA = inputA.slice();
    const originalB = inputB.slice();
    const imagA = new Float64Array(size);
    const imagB = new Float64Array(size);

    const fftA = new FFT(size);
    const fftB = new FFT(size);
    fftA.forward(inputA, imagA);
    fftB.forward(inputB, imagB);
    fftA.inverse(inputA, imagA);
    fftB.inverse(inputB, imagB);

    for (let i = 0; i < size; i++) {
      expect(inputA[i]).toBeCloseTo(originalA[i], 9);
      expect(inputB[i]).toBeCloseTo(originalB[i], 9);
    }
  });

  it('reuses the cached Hann window for the same size', () => {
    const first = hannWindow(4_096);
    const second = hannWindow(4_096);
    expect(second).toBe(first);
    expect(first[0]).toBe(0);
    expect(first[1]).toBeGreaterThan(0);
    expect(first[2_048]).toBeCloseTo(1, 6);
  });

  it('keeps different window sizes in separate cache entries', () => {
    const small = hannWindow(512);
    const large = hannWindow(1_024);
    expect(small).not.toBe(large);
    expect(small).toHaveLength(512);
    expect(large).toHaveLength(1_024);
    expect(hannWindow(512)).toBe(small);
  });

  it('preserves the empty window behavior', () => {
    expect(hannWindow(0)).toHaveLength(0);
  });
});
