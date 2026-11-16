import { describe, expect, it } from 'vitest';
import { Lr4Crossover } from './crossover';

interface Response {
  magnitude: number;
  phase: number;
}

function measureResponse(
  sampleRate: number,
  frequency: number,
  lowCutoff = 180,
  highCutoff = 4500,
): Response {
  const frames = sampleRate;
  const blockSize = 256;
  const crossover = new Lr4Crossover(sampleRate);
  crossover.prepare(sampleRate, blockSize);
  crossover.configure(sampleRate, lowCutoff, highCutoff);
  const inputL = new Float32Array(blockSize);
  const inputR = new Float32Array(blockSize);
  const lowL = new Float32Array(blockSize);
  const lowR = new Float32Array(blockSize);
  const midL = new Float32Array(blockSize);
  const midR = new Float32Array(blockSize);
  const highL = new Float32Array(blockSize);
  const highR = new Float32Array(blockSize);
  const output = { lowL, lowR, midL, midR, highL, highR };
  let sinSum = 0;
  let cosSum = 0;
  let count = 0;

  for (let offset = 0; offset < frames; offset += blockSize) {
    const n = Math.min(blockSize, frames - offset);
    for (let i = 0; i < n; i++) {
      const sample = Math.sin((2 * Math.PI * frequency * (offset + i)) / sampleRate);
      inputL[i] = sample;
      inputR[i] = sample;
    }
    crossover.split(inputL, inputR, n, output);
    if (offset >= frames / 2) {
      for (let i = 0; i < n; i++) {
        const absoluteSample = offset + i;
        const phase = (2 * Math.PI * frequency * absoluteSample) / sampleRate;
        const reconstructed = lowL[i] + midL[i] + highL[i];
        sinSum += reconstructed * Math.sin(phase);
        cosSum += reconstructed * Math.cos(phase);
        count++;
      }
    }
  }

  return {
    magnitude: (2 * Math.hypot(sinSum, cosSum)) / count,
    phase: Math.atan2(cosSum, sinSum),
  };
}

function phaseDistance(a: number, b: number): number {
  let difference = b - a;
  while (difference > Math.PI) difference -= 2 * Math.PI;
  while (difference < -Math.PI) difference += 2 * Math.PI;
  return Math.abs(difference);
}

describe('Lr4Crossover reconstruction and phase', () => {
  it.each([44_100, 48_000, 96_000])('reconstructs the summed signal at %i Hz sample rate', (sampleRate) => {
    const frequencies = [50, 100, 180, 200, 500, 1000, 4000, 4500, 8000, 12_000];
    for (const frequency of frequencies) {
      if (frequency >= sampleRate / 2) continue;
      const response = measureResponse(sampleRate, frequency);
      expect(response.magnitude, `${frequency} Hz at ${sampleRate} Hz`).toBeGreaterThan(0.98);
      expect(response.magnitude, `${frequency} Hz at ${sampleRate} Hz`).toBeLessThan(1.02);
      expect(Number.isFinite(response.phase)).toBe(true);
    }
  });

  it('keeps reconstructed phase continuous across both crossover boundaries', () => {
    const lowPhases = [162, 180, 198].map((frequency) => measureResponse(48_000, frequency).phase);
    const highPhases = [4050, 4500, 4950].map((frequency) => measureResponse(48_000, frequency).phase);
    for (const phases of [lowPhases, highPhases]) {
      for (let i = 1; i < phases.length; i++) {
        expect(phaseDistance(phases[i - 1], phases[i])).toBeLessThan(1);
      }
    }
  });

  it('uses the requested ordered cutoffs without imposing a 2:1 ratio', () => {
    const crossover = new Lr4Crossover(48_000);
    crossover.configure(48_000, 600, 800);
    expect(crossover.lowCutoff).toBe(600);
    expect(crossover.highCutoff).toBe(800);
  });

  it('clamps hostile cutoffs to finite values below Nyquist', () => {
    const sampleRate = 48_000;
    const crossover = new Lr4Crossover(sampleRate);
    crossover.configure(sampleRate, Number.NaN, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(crossover.lowCutoff)).toBe(true);
    expect(Number.isFinite(crossover.highCutoff)).toBe(true);
    expect(crossover.highCutoff).toBeGreaterThan(crossover.lowCutoff);
    expect(crossover.highCutoff).toBeLessThanOrEqual(sampleRate * 0.45);
  });

  it.each([44_100, 48_000, 96_000])('stays stable with crossover and test tone near Nyquist at %i Hz', (sampleRate) => {
    const response = measureResponse(
      sampleRate,
      sampleRate * 0.49,
      sampleRate * 0.4,
      sampleRate * 0.45,
    );
    expect(Number.isFinite(response.magnitude)).toBe(true);
    expect(response.magnitude).toBeGreaterThan(0.98);
    expect(response.magnitude).toBeLessThan(1.02);
  });
});
