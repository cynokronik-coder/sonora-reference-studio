import { describe, expect, it } from 'vitest';
import { Lr4Crossover } from './crossover';

const BLOCK_SIZE = 256;
const FRAME_COUNT = 48_000;

function reconstructedMagnitude(
  sampleRate: number,
  frequency: number,
  lowCutoff = 180,
  highCutoff = 4_500,
): number {
  const crossover = new Lr4Crossover(sampleRate);
  crossover.prepare(sampleRate, BLOCK_SIZE);
  crossover.configure(sampleRate, lowCutoff, highCutoff);

  const inputL = new Float32Array(BLOCK_SIZE);
  const inputR = new Float32Array(BLOCK_SIZE);
  const lowL = new Float32Array(BLOCK_SIZE);
  const lowR = new Float32Array(BLOCK_SIZE);
  const midL = new Float32Array(BLOCK_SIZE);
  const midR = new Float32Array(BLOCK_SIZE);
  const highL = new Float32Array(BLOCK_SIZE);
  const highR = new Float32Array(BLOCK_SIZE);
  const output = { lowL, lowR, midL, midR, highL, highR };

  let inputPower = 0;
  let outputPower = 0;
  let count = 0;
  let absoluteSample = 0;

  while (absoluteSample < FRAME_COUNT) {
    const frames = Math.min(BLOCK_SIZE, FRAME_COUNT - absoluteSample);
    for (let i = 0; i < frames; i++) {
      const sample = Math.sin((2 * Math.PI * frequency * (absoluteSample + i)) / sampleRate);
      inputL[i] = sample;
      inputR[i] = sample;
    }
    crossover.split(inputL, inputR, frames, output);
    if (absoluteSample >= FRAME_COUNT / 2) {
      for (let i = 0; i < frames; i++) {
        const sum = lowL[i] + midL[i] + highL[i];
        inputPower += inputL[i] * inputL[i];
        outputPower += sum * sum;
        count++;
      }
    }
    absoluteSample += frames;
  }

  return Math.sqrt(outputPower / Math.max(1, inputPower));
}

describe('Lr4Crossover three-band reconstruction', () => {
  it.each([40, 90, 180, 360, 1_000, 3_000, 4_500, 8_000, 15_000])(
    'preserves unity magnitude around and between crossovers at %i Hz',
    (frequency) => {
      const ratio = reconstructedMagnitude(48_000, frequency);
      expect(ratio).toBeGreaterThan(0.97);
      expect(ratio).toBeLessThan(1.03);
    },
  );

  it.each([44_100, 48_000, 96_000, 192_000])(
    'keeps crossover cutoffs in range at %i Hz sample rate',
    (sampleRate) => {
      const crossover = new Lr4Crossover(sampleRate);
      crossover.configure(sampleRate, 600, 800);
      expect(crossover.lowCutoff).toBeGreaterThan(0);
      expect(crossover.highCutoff).toBeGreaterThan(crossover.lowCutoff);
      expect(crossover.highCutoff).toBeCloseTo(800, 4);
      expect(crossover.highCutoff).toBeLessThanOrEqual(sampleRate * 0.45 + 1e-6);
    },
  );
});
