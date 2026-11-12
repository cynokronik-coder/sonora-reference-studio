import { describe, expect, it } from 'vitest';
import { FFT } from '../fft';
import { Biquad, designBiquad, magnitudeDb } from '../biquad';
import { ParametricEq } from '../processors/eq';
import { Compressor } from '../processors/compressor';
import { Limiter } from '../processors/limiter';
import { Saturator } from '../processors/saturation';
import { MultibandCompressor } from '../processors/multiband';
import { ProcessorChain } from '../chain';
import { createDefaultParams, PROCESSOR_DEFINITIONS } from '../registry';
import { Lr4Crossover } from '../crossover';
import { analyzeLoudness } from '../../analysis/loudness';
import { accumulateSpectrum, createSpectrumAccum, finalizeSpectrum } from '../../analysis/spectrum';
import { analyzeStereo } from '../../analysis/stereo';
import { analyzeRhythm } from '../../analysis/rhythm';
import { encodeWav, parseWavHeader, parseAiffHeader, encodeAiff, detectHeader } from '../../io/wav';
import { BUILT_IN_PRESETS } from '../../presets/library';
import { intensityScale, effectiveScales } from '../../analysis/match';
import { valueAtTime } from '../automation';
import { dbToGain, gainToDb } from '../util';

const SR = 48000;

function stereoBuffer(seconds: number, fn: (t: number, i: number) => number, fnR?: (t: number, i: number) => number) {
  const n = Math.floor(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    L[i] = fn(t, i);
    R[i] = fnR ? fnR(t, i) : L[i];
  }
  return { L, R, n };
}

function rmsOf(buf: Float32Array, from = Math.floor(buf.length * 0.5)): number {
  let sum = 0;
  for (let i = from; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length - from));
}

describe('FFT', () => {
  it('round-trips a signal', () => {
    const fft = new FFT(1024);
    const re = new Float64Array(1024);
    const im = new Float64Array(1024);
    const original = new Float64Array(1024);
    for (let i = 0; i < 1024; i++) {
      re[i] = Math.sin(i * 0.1) + Math.cos(i * 0.031);
      original[i] = re[i];
    }
    fft.forward(re, im);
    fft.inverse(re, im);
    let maxError = 0;
    for (let i = 0; i < 1024; i++) maxError = Math.max(maxError, Math.abs(re[i] - original[i]));
    expect(maxError).toBeLessThan(1e-8);
  });
});

describe('biquad and EQ', () => {
  it('has the expected gain at the bell centre', () => {
    const coeffs = designBiquad('peak', 1000, 6, 1, SR);
    expect(magnitudeDb(coeffs, 1000, SR)).toBeCloseTo(6, 1);
    expect(magnitudeDb(coeffs, 50, SR)).toBeLessThan(0.5);
  });

  it('amplifies a sine through a +6 dB bell', () => {
    const eq = new ParametricEq();
    eq.prepare(SR, 512);
    eq.setValues({
      ...createDefaultParams('eq'),
      b0_on: 1,
      b0_type: 0,
      b0_freq: 1000,
      b0_gain: 6,
      b0_q: 1,
    });
    const { L, R } = stereoBuffer(2, (t) => 0.1 * Math.sin(2 * Math.PI * 1000 * t));
    const inputRms = rmsOf(L);
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      eq.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    const outputRms = rmsOf(L);
    expect(20 * Math.log10(outputRms / inputRms)).toBeCloseTo(6, 0);
  });

  it('removes DC with a high-pass band', () => {
    const eq = new ParametricEq();
    eq.prepare(SR, 512);
    eq.setValues({
      ...createDefaultParams('eq'),
      b0_on: 1,
      b0_type: 3,
      b0_freq: 100,
      b0_q: 0.707,
    });
    const L = new Float32Array(SR).fill(1);
    const R = new Float32Array(SR).fill(1);
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      eq.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    expect(Math.abs(L[L.length - 1])).toBeLessThan(0.01);
  });
});

describe('dynamics', () => {
  it('keeps resonance suppression and de-essing fully transparent when their chain nodes are bypassed', () => {
    const chain = new ProcessorChain(SR, 256);
    chain.update([
      { id: 'resonance', type: 'resonance', enabled: false, params: { ...createDefaultParams('resonance'), output: 12, mix: 0 } },
      { id: 'deesser', type: 'deesser', enabled: false, params: { ...createDefaultParams('deesser'), output: 12, mix: 0 } },
    ]);
    const left = new Float32Array(1024);
    const right = new Float32Array(1024);
    for (let i = 0; i < left.length; i++) {
      left[i] = 0.6 * Math.sin((2 * Math.PI * 3200 * i) / SR);
      right[i] = 0.3 * Math.sin((2 * Math.PI * 8500 * i) / SR);
    }
    const originalL = left.slice();
    const originalR = right.slice();

    chain.process(left, right, left.length);

    expect(left).toEqual(originalL);
    expect(right).toEqual(originalR);
  });

  it('keeps the compressor sidechain filter independent between stereo channels', () => {
    const process = (left: Float32Array, right: Float32Array) => {
      const comp = new Compressor();
      comp.prepare(SR, 512);
      comp.setValues({
        ...createDefaultParams('compressor'),
        threshold: -36,
        ratio: 8,
        attack: 2,
        release: 100,
        knee: 0,
        lookahead: 0,
        scHpf: 120,
        style: 0,
        link: 100,
        mix: 100,
        makeup: 0,
        autoMakeup: 0,
      });
      const L = left.slice();
      const R = right.slice();
      for (let i = 0; i < L.length; i += 512) {
        const n = Math.min(512, L.length - i);
        comp.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
      }
      return { L, R };
    };
    const input = stereoBuffer(
      1,
      (t) => 0.45 * Math.sin(2 * Math.PI * 180 * t) + 0.08 * Math.sin(2 * Math.PI * 900 * t),
      (t) => 0.12 * Math.sin(2 * Math.PI * 4200 * t + 0.2),
    );
    const normal = process(input.L, input.R);
    const swapped = process(input.R, input.L);
    let error = 0;
    for (let i = 0; i < input.n; i++) {
      error = Math.max(error, Math.abs(normal.L[i] - swapped.R[i]), Math.abs(normal.R[i] - swapped.L[i]));
    }
    expect(error).toBeLessThan(1e-5);
  });

  it('uses the Stereo Link control to blend peak-linked and average detection', () => {
    const renderQuietChannel = (link: number) => {
      const comp = new Compressor();
      comp.prepare(SR, 512);
      comp.setValues({
        ...createDefaultParams('compressor'),
        threshold: -30,
        ratio: 8,
        attack: 1,
        release: 100,
        knee: 0,
        lookahead: 0,
        scHpf: 20,
        style: 0,
        link,
        mix: 100,
        makeup: 0,
        autoMakeup: 0,
      });
      const { L, R } = stereoBuffer(
        2,
        (t) => 0.8 * Math.sin(2 * Math.PI * 1000 * t),
        (t) => 0.08 * Math.sin(2 * Math.PI * 1000 * t),
      );
      for (let i = 0; i < L.length; i += 512) {
        const n = Math.min(512, L.length - i);
        comp.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
      }
      return rmsOf(R);
    };
    expect(renderQuietChannel(0)).toBeGreaterThan(renderQuietChannel(100) * 1.1);
  });

  it('reduces a signal above threshold and reports gain reduction', () => {
    const comp = new Compressor();
    comp.prepare(SR, 512);
    comp.setValues({
      ...createDefaultParams('compressor'),
      threshold: -24,
      ratio: 4,
      attack: 5,
      release: 120,
      knee: 6,
      lookahead: 0,
      mix: 100,
      makeup: 0,
      autoMakeup: 0,
    });
    const { L, R } = stereoBuffer(2, (t) => 0.5 * Math.sin(2 * Math.PI * 220 * t));
    const inputRms = rmsOf(L);
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      comp.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    const outputRms = rmsOf(L);
    expect(outputRms).toBeLessThan(inputRms * 0.75);
    expect(comp.meter().reduction ?? 0).toBeGreaterThan(2);
  });

  it('limits peaks to the ceiling with lookahead', () => {
    const limiter = new Limiter();
    limiter.prepare(SR, 512);
    limiter.setValues({
      ...createDefaultParams('limiter'),
      ceiling: -1,
      lookahead: 4,
      release: 80,
      truePeak: 1,
      input: 0,
      output: 0,
    });
    const { L, R } = stereoBuffer(2, (t) => 0.98 * Math.sin(2 * Math.PI * 90 * t));
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      limiter.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    let peak = 0;
    for (let i = Math.floor(L.length * 0.5); i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    expect(peak).toBeLessThanOrEqual(dbToGain(-1) + 0.002);
    expect(limiter.meter().reduction ?? 0).toBeGreaterThan(0.5);
  });

  it('adds harmonics with saturation and stays finite', () => {
    const sat = new Saturator();
    sat.prepare(SR, 512);
    sat.setValues({ ...createDefaultParams('saturation'), mode: 1, drive: 9, mix: 100, oversample: 2 });
    const { L, R } = stereoBuffer(1, (t) => 0.4 * Math.sin(2 * Math.PI * 440 * t));
    const reference = L.slice();
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      sat.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    let error = 0;
    let finite = true;
    for (let i = 0; i < L.length; i++) {
      if (!Number.isFinite(L[i])) finite = false;
      error += (L[i] - reference[i]) * (L[i] - reference[i]);
    }
    expect(finite).toBe(true);
    expect(error).toBeGreaterThan(0.01);
  });

  it('sums multiband compression bands back without silence', () => {
    const mb = new MultibandCompressor();
    mb.prepare(SR, 512);
    mb.setValues({ ...createDefaultParams('multibandComp') });
    const { L, R } = stereoBuffer(1, (t) => 0.2 * Math.sin(2 * Math.PI * 120 * t) + 0.1 * Math.sin(2 * Math.PI * 3000 * t));
    for (let i = 0; i < L.length; i += 512) {
      const n = Math.min(512, L.length - i);
      mb.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
    }
    expect(rmsOf(L)).toBeGreaterThan(0.05);
  });
});

describe('crossover', () => {
  it('splits bands with approximately flat summed energy', () => {
    const xover = new Lr4Crossover(SR);
    xover.prepare(SR, 512);
    xover.configure(SR, 300, 4000);
    const n = SR;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = R[i] = (Math.random() * 2 - 1) * 0.2;
    const sum = new Float32Array(n);
    for (let i = 0; i < n; i += 512) {
      const frames = Math.min(512, n - i);
      const out = {
        lowL: new Float32Array(512), lowR: new Float32Array(512),
        midL: new Float32Array(512), midR: new Float32Array(512),
        highL: new Float32Array(512), highR: new Float32Array(512),
      };
      xover.split(L.subarray(i, i + frames), R.subarray(i, i + frames), frames, out);
      for (let k = 0; k < frames; k++) sum[i + k] = out.lowL[k] + out.midL[k] + out.highL[k];
    }
    const inputRms = rmsOf(L, n / 2);
    const sumRms = rmsOf(sum, n / 2);
    expect(20 * Math.log10(sumRms / inputRms)).toBeGreaterThan(-1.5);
    expect(20 * Math.log10(sumRms / inputRms)).toBeLessThan(1.5);
  });
});

describe('analysis', () => {
  it('measures a -20 dBFS stereo 1 kHz tone near -20 LUFS', () => {
    const { L, R } = stereoBuffer(4, (t) => 0.1 * Math.sin(2 * Math.PI * 1000 * t));
    const report = analyzeLoudness(L, R, SR);
    expect(report.integratedLufs).toBeGreaterThan(-21.5);
    expect(report.integratedLufs).toBeLessThan(-18.5);
    expect(report.truePeakDb).toBeGreaterThanOrEqual(report.samplePeakDb - 0.2);
    expect(report.samplePeakDb).toBeCloseTo(-20, 0);
  });

  it('keeps K-weighting state independent between stereo channels', () => {
    const { L, R } = stereoBuffer(
      3,
      (t) => 0.18 * Math.sin(2 * Math.PI * 997 * t),
      (t) => 0.035 * Math.sin(2 * Math.PI * 310 * t + 0.3),
    );
    const normal = analyzeLoudness(L, R, SR);
    const swapped = analyzeLoudness(R, L, SR);
    expect(normal.integratedLufs).toBeCloseTo(swapped.integratedLufs, 5);
    expect(normal.truePeakDb).toBeCloseTo(swapped.truePeakDb, 5);
  });

  it('does not lose spectral energy when stereo channels are out of phase', () => {
    const correlated = stereoBuffer(1, (t) => 0.2 * Math.sin(2 * Math.PI * 1000 * t));
    const inverted = stereoBuffer(
      1,
      (t) => 0.2 * Math.sin(2 * Math.PI * 1000 * t),
      (t) => -0.2 * Math.sin(2 * Math.PI * 1000 * t),
    );
    const measure = (L: Float32Array, R: Float32Array) => {
      const accum = createSpectrumAccum(SR);
      accumulateSpectrum(accum, L, R);
      return finalizeSpectrum(accum);
    };
    const a = measure(correlated.L, correlated.R);
    const b = measure(inverted.L, inverted.R);
    const bandA = a.bands.find((band) => band.center === 1000)!;
    const bandB = b.bands.find((band) => band.center === 1000)!;
    expect(Number.isFinite(bandB.db)).toBe(true);
    expect(bandB.db).toBeCloseTo(bandA.db, 3);
  });

  it('detects correlated and anti-correlated stereo', () => {
    const a = stereoBuffer(2, (t) => 0.2 * Math.sin(2 * Math.PI * 300 * t));
    const correlated = analyzeStereo(a.L, a.R, SR);
    expect(correlated.correlation).toBeCloseTo(1, 2);
    expect(correlated.monoCompatibility).toBeGreaterThan(99);

    const inverted = analyzeStereo(a.L, a.R.map((v) => -v), SR);
    expect(inverted.correlation).toBeCloseTo(-1, 2);
    expect(inverted.monoCompatibility).toBeLessThan(5);
  });

  it('estimates tempo of a regular click pattern', () => {
    const bpm = 120;
    const interval = 60 / bpm;
    const { L } = stereoBuffer(8, (t) => {
      const phase = t % interval;
      return phase < 0.02 ? Math.sin(2 * Math.PI * 1000 * phase) * 0.6 : 0;
    });
    const rhythm = analyzeRhythm(L, L, SR);
    expect(rhythm.tempoBpm).toBeGreaterThan(110);
    expect(rhythm.tempoBpm).toBeLessThan(130);
    expect(rhythm.sections.length).toBeGreaterThanOrEqual(1);
  });
});

describe('containers', () => {
  it('writes and parses a 16-bit WAV header', async () => {
    const { L, R } = stereoBuffer(0.25, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t));
    const blob = encodeWav(L, R, {
      sampleRate: SR,
      bitDepth: 16,
      dither: false,
    });
    const buffer = await blob.arrayBuffer();
    const header = parseWavHeader(buffer);
    expect(header?.sampleRate).toBe(SR);
    expect(header?.channels).toBe(2);
    expect(header?.bitDepth).toBe(16);
    expect(detectHeader(buffer)?.format).toBe('WAV');
    expect(buffer.byteLength).toBe(44 + L.length * 4);
    const view = new DataView(buffer);
    const first = view.getInt16(44, true);
    expect(Math.abs(first)).toBeLessThan(100);

    const withMetadata = encodeWav(L, R, {
      sampleRate: SR,
      bitDepth: 16,
      dither: true,
      metadata: { title: 'Test', artist: 'Sonora', comment: 'metadata chunk' },
    });
    const metaBytes = await withMetadata.arrayBuffer();
    expect(metaBytes.byteLength).toBeGreaterThan(buffer.byteLength);
    expect(parseWavHeader(metaBytes)?.sampleRate).toBe(SR);
  });

  it('writes and parses a 24-bit AIFF including the 80-bit sample rate', async () => {
    const { L, R } = stereoBuffer(0.2, (t) => 0.3 * Math.sin(2 * Math.PI * 220 * t));
    const blob = encodeAiff(L, R, SR, 24);
    const buffer = await blob.arrayBuffer();
    const header = parseAiffHeader(buffer);
    expect(header?.sampleRate).toBe(SR);
    expect(header?.channels).toBe(2);
    expect(header?.bitDepth).toBe(24);
    expect(header?.format).toBe('AIFF');
  });
});

describe('presets and matching', () => {
  it('every built-in preset references real processors and valid parameters', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const processor of preset.processors) {
        const def = PROCESSOR_DEFINITIONS.find((d) => d.type === processor.type);
        expect(def, `${preset.name}: ${processor.type}`).toBeDefined();
        for (const [key, value] of Object.entries(processor.params)) {
          const spec = def!.params.find((p) => p.key === key);
          expect(spec, `${preset.name}: ${processor.type}.${key}`).toBeDefined();
          if (spec && spec.kind === 'float') {
            expect(value).toBeGreaterThanOrEqual(spec.min ?? -Infinity);
            expect(value).toBeLessThanOrEqual(spec.max ?? Infinity);
          }
        }
      }
    }
  });

  it('applies a perceptual intensity curve and respects category toggles', () => {
    expect(intensityScale(100, 100, 1)).toBe(1);
    expect(intensityScale(50, 100, 1.25)).toBeCloseTo(Math.pow(0.5, 1.25), 5);
    expect(intensityScale(25, 100, 1.25)).toBeLessThan(0.25);
    const scales = effectiveScales({
      ...({
        enabled: true,
        intensity: 80,
        frequencyBalance: 100,
        loudness: 50,
        dynamics: 50,
        stereoWidth: 50,
        punch: 50,
        saturation: 50,
        character: 50,
        maxEqBoost: 6,
        maxEqCut: 8,
        maxLoudnessChange: 6,
        protectLowEnd: true,
        protectHighEnd: false,
        excludeLowHz: 20,
        excludeHighHz: 20000,
        targetSection: 'full',
        referenceSection: 'full',
        categorySource: {},
        matchTonal: false,
        matchLoudness: true,
        matchDynamics: true,
        matchStereo: true,
        matchLowEnd: true,
        matchHighEnd: true,
        matchPunch: true,
      } as const),
    });
    expect(scales.frequencyBalance).toBe(0);
    expect(scales.loudness).toBeGreaterThan(0);
  });
});

describe('automation', () => {
  it('interpolates linear and exponential lanes', () => {
    const points = [
      { time: 0, value: 0, curve: 0 as const },
      { time: 10, value: 10, curve: 0 as const },
    ];
    expect(valueAtTime(points, 5, -1)).toBe(5);
    const exp = [
      { time: 0, value: 1, curve: 1 as const },
      { time: 10, value: 100, curve: 1 as const },
    ];
    expect(valueAtTime(exp, 5, 0)).toBeCloseTo(10, 5);
  });
});

describe('gain staging', () => {
  it('round-trips dB conversion', () => {
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 6);
  });
});

void Biquad;
