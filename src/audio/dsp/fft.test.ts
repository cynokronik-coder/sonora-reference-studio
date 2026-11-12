import { describe, expect, it, vi } from 'vitest';
import { FFT } from './fft';

describe('FFT plans', () => {
  it.each([2, 8, 64, 1_024, 4_096])('round-trips complex samples for size %i', (size) => {
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      real[i] = Math.sin(i * 0.071) * 0.7 + Math.cos(i * 0.013) * 0.2;
      imaginary[i] = Math.cos(i * 0.037) * 0.15;
    }
    const expectedReal = real.slice();
    const expectedImaginary = imaginary.slice();
    const fft = new FFT(size);

    fft.forward(real, imaginary);
    fft.inverse(real, imaginary);

    for (let i = 0; i < size; i++) {
      expect(real[i]).toBeCloseTo(expectedReal[i], 9);
      expect(imaginary[i]).toBeCloseTo(expectedImaginary[i], 9);
    }
  });

  it('shares plans without sharing mutable transform buffers', () => {
    const size = 2_048;
    const inputA = Float64Array.from({ length: size }, (_, i) => Math.sin(i * 0.02));
    const inputB = Float64Array.from({ length: size }, (_, i) => Math.cos(i * 0.031));
    const originalA = inputA.slice();
    const originalB = inputB.slice();
    const imaginaryA = new Float64Array(size);
    const imaginaryB = new Float64Array(size);
    const fftA = new FFT(size);
    const fftB = new FFT(size);

    fftA.forward(inputA, imaginaryA);
    fftB.forward(inputB, imaginaryB);
    fftA.inverse(inputA, imaginaryA);
    fftB.inverse(inputB, imaginaryB);

    for (let i = 0; i < size; i++) {
      expect(inputA[i]).toBeCloseTo(originalA[i], 9);
      expect(inputB[i]).toBeCloseTo(originalB[i], 9);
    }
  });

  it('reuses twiddle tables for repeated transform sizes', () => {
    const size = 8_192;
    const sineSpy = vi.spyOn(Math, 'sin');
    const cosineSpy = vi.spyOn(Math, 'cos');
    try {
      new FFT(size);
      const sineCalls = sineSpy.mock.calls.length;
      const cosineCalls = cosineSpy.mock.calls.length;
      new FFT(size);
      expect(sineSpy).toHaveBeenCalledTimes(sineCalls);
      expect(cosineSpy).toHaveBeenCalledTimes(cosineCalls);
    } finally {
      sineSpy.mockRestore();
      cosineSpy.mockRestore();
    }
  });
});
