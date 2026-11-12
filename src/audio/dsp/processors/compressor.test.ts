import { describe, expect, it } from 'vitest';
import { Compressor } from './compressor';

const COMMON = {
  threshold: -18,
  ratio: 4,
  attack: 0.1,
  release: 100,
  knee: 0,
  lookahead: 0,
  style: 0,
  scHpf: 20,
  makeup: 0,
  autoMakeup: 0,
  mix: 100,
};

function renderSines(link: number, leftAmplitude: number, rightAmplitude: number, seconds = 1) {
  const sampleRate = 48_000;
  const frames = sampleRate * seconds;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    left[i] = sample * leftAmplitude;
    right[i] = sample * rightAmplitude;
  }
  const inputLeft = left.slice();
  const inputRight = right.slice();
  const compressor = new Compressor();
  compressor.prepare(sampleRate, 512);
  compressor.setValues({ ...COMMON, link });
  for (let i = 0; i < frames; i += 512) {
    compressor.process(left.subarray(i, Math.min(i + 512, frames)), right.subarray(i, Math.min(i + 512, frames)), Math.min(512, frames - i));
  }
  const start = Math.floor(frames * 0.75);
  let inL = 0;
  let inR = 0;
  let outL = 0;
  let outR = 0;
  for (let i = start; i < frames; i++) {
    inL += inputLeft[i] ** 2;
    inR += inputRight[i] ** 2;
    outL += left[i] ** 2;
    outR += right[i] ** 2;
  }
  return {
    left,
    right,
    gainL: Math.sqrt(outL / inL),
    gainR: Math.sqrt(outR / inR),
  };
}

describe('Compressor stereo detection', () => {
  it('uses a common gain reduction at full link', () => {
    const result = renderSines(100, 0.8, 0.05);
    expect(result.gainL).toBeCloseTo(result.gainR, 3);
    expect(result.gainL).toBeLessThan(0.6);
  });

  it('uses independent gain reduction at zero link', () => {
    const result = renderSines(0, 0.8, 0.05);
    expect(result.gainL).toBeLessThan(0.6);
    expect(result.gainR).toBeGreaterThan(0.95);
  });

  it('keeps matching channel histories symmetrical in independent mode', () => {
    const result = renderSines(0, 0.55, 0.55);
    for (let i = 0; i < result.left.length; i += 97) {
      expect(result.left[i]).toBeCloseTo(result.right[i], 6);
    }
  });

  it('uses independent filtered external sidechain channels', () => {
    const sampleRate = 48_000;
    const frames = sampleRate;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const keyL = new Float32Array(frames);
    const keyR = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const sample = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
      left[i] = right[i] = sample * 0.2;
      keyL[i] = sample * 0.9;
      keyR[i] = sample * 0.03;
    }
    const compressor = new Compressor();
    compressor.prepare(sampleRate, 512);
    compressor.setValues({ ...COMMON, link: 0 });
    for (let i = 0; i < frames; i += 512) {
      const n = Math.min(512, frames - i);
      compressor.setSidechain(keyL.subarray(i, i + n), keyR.subarray(i, i + n));
      compressor.process(left.subarray(i, i + n), right.subarray(i, i + n), n);
    }
    let leftPower = 0;
    let rightPower = 0;
    for (let i = frames * 3 / 4; i < frames; i++) {
      leftPower += left[i] ** 2;
      rightPower += right[i] ** 2;
    }
    expect(leftPower).toBeLessThan(rightPower * 0.5);
  });

  it.each([44_100, 48_000, 96_000])('reports and applies exact 4 ms lookahead at %i Hz', (sampleRate) => {
    const delay = Math.round(sampleRate * 0.004);
    const left = new Float32Array(delay + 32);
    const right = new Float32Array(delay + 32);
    left[0] = right[0] = 1;
    const compressor = new Compressor();
    compressor.prepare(sampleRate, 128);
    compressor.setValues({
      ...COMMON,
      threshold: -60,
      ratio: 1,
      lookahead: 4,
    });
    expect(compressor.latency).toBe(delay);
    for (let i = 0; i < left.length; i += 128) {
      const n = Math.min(128, left.length - i);
      compressor.process(left.subarray(i, i + n), right.subarray(i, i + n), n);
    }
    expect(left[delay]).toBeCloseTo(1, 6);
    if (delay > 0) expect(left[delay - 1]).toBe(0);
  });

  it('smooths makeup changes instead of stepping the output gain', () => {
    const compressor = new Compressor();
    compressor.prepare(48_000, 128);
    compressor.setValues({ ...COMMON, threshold: -60, ratio: 1 });
    const firstL = new Float32Array(128).fill(0.5);
    const firstR = firstL.slice();
    compressor.process(firstL, firstR, firstL.length);

    compressor.setValues({ ...COMMON, threshold: -60, ratio: 1, makeup: 12 });
    const nextL = new Float32Array(128).fill(0.5);
    const nextR = nextL.slice();
    compressor.process(nextL, nextR, nextL.length);
    expect(nextL[0]).toBeGreaterThan(firstL[127]);
    expect(nextL[0] - firstL[127]).toBeLessThan(0.1);
  });

  it('keeps output finite for non-finite parameter values', () => {
    const compressor = new Compressor();
    compressor.prepare(48_000, 128);
    compressor.setValues({
      ...COMMON,
      threshold: Number.NaN,
      ratio: Number.POSITIVE_INFINITY,
      attack: Number.NaN,
      scHpf: Number.NaN,
      lookahead: Number.NaN,
      link: Number.NaN,
      makeup: Number.NaN,
      mix: Number.NaN,
    });
    const left = new Float32Array(128).fill(0.5);
    const right = left.slice();
    compressor.process(left, right, 128);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });
});
