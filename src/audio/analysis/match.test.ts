import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from './analyze';
import { estimatePreLimiterTruePeak, resolveReferenceMetrics } from './match';

function report(options: {
  lufs?: number;
  truePeak?: number;
  crest?: number;
  lra?: number;
  width?: number;
  punch?: number;
  bands?: number[];
  duration?: number;
  chorus?: boolean;
} = {}): AnalysisReport {
  const bands = (options.bands ?? [-24, -18, -20, -30]).map((db, index) => ({
    center: [100, 500, 2000, 8000][index] ?? 1000 * (index + 1),
    db,
    relativeDb: 0,
  }));
  const averageDb = bands.reduce((sum, band) => sum + band.db, 0) / bands.length;
  bands.forEach((band) => { band.relativeDb = band.db - averageDb; });
  const base = {
    lufs: options.lufs ?? -16,
    truePeak: options.truePeak ?? -1.2,
    crest: options.crest ?? 8,
    lra: options.lra ?? 5,
    width: options.width ?? -8,
    punch: options.punch ?? 0.5,
    duration: options.duration ?? 90,
  };
  return {
    version: 1,
    createdAt: 1,
    sampleRate: 48000,
    channels: 2,
    duration: base.duration,
    loudness: {
      integratedLufs: base.lufs,
      truePeakDb: base.truePeak,
      crestDb: base.crest,
      lra: base.lra,
      plrDb: base.crest,
    },
    spectrum: {
      bands,
      centroidHz: 1200,
      rolloffHz: 12000,
      tiltDbPerOct: -1,
      flatness: 0.2,
      lowEnergyDb: -20,
      highEnergyDb: -28,
      resonances: [],
      maxBuildupDb: 0,
      buildupBands: [],
    },
    stereo: {
      widthDb: base.width,
      correlation: 0.8,
      midEnergyDb: -12,
      sideEnergyDb: -20,
      balanceDb: 0,
      monoCompatibility: 95,
      lowSideRatioDb: -24,
      bandWidth: [],
    },
    rhythm: {
      tempoBpm: 120,
      beatConfidence: 0.9,
      onsetDensity: 1.2,
      punchScore: base.punch,
      attackSharpness: 0.6,
      sections: [{ start: 0, end: base.duration }],
    },
    sections: options.chorus ? [{
      index: 0,
      label: 'chorus',
      start: 20,
      end: 50,
      lufs: base.lufs,
      crestDb: base.crest,
      widthDb: base.width,
      correlation: 0.8,
      bands: bands.map((band) => ({ ...band })),
      punchScore: base.punch,
    }] : [],
    transients: {
      crestDb: base.crest,
      plrDb: base.crest,
      attackDensity: 1.2,
      punchScore: base.punch,
      maxShortTermLufs: base.lufs,
    },
    resonances: [],
    warnings: [],
  } as unknown as AnalysisReport;
}

describe('reference consensus resolution', () => {
  it('blends loudness in linear power using the configured reference weights', () => {
    const resolved = resolveReferenceMetrics(-1, [
      { assetId: 'warm', report: report({ lufs: -18 }), weight: 100 },
      { assetId: 'loud', report: report({ lufs: -12 }), weight: 50 },
    ], 'full');
    expect(resolved.assetIds).toEqual(['warm', 'loud']);
    expect(resolved.name).toBe('weighted reference blend');
    expect(resolved.metrics.lufs).toBeCloseTo(-15, 1);
  });

  it('blends true peak in linear amplitude rather than averaging dB values', () => {
    const resolved = resolveReferenceMetrics(-1, [
      { assetId: 'quiet-peak', report: report({ truePeak: -6 }), weight: 100 },
      { assetId: 'hot-peak', report: report({ truePeak: -3 }), weight: 50 },
    ], 'full');
    expect(resolved.metrics.truePeakDb).toBeCloseTo(-4.88, 1);
  });

  it('excludes zero-weight references from a weighted blend', () => {
    const resolved = resolveReferenceMetrics(-1, [
      { assetId: 'included', report: report({ lufs: -18 }), weight: 100 },
      { assetId: 'excluded', report: report({ lufs: -6 }), weight: 0 },
    ], 'full');
    expect(resolved.assetIds).toEqual(['included']);
    expect(resolved.metrics.lufs).toBeCloseTo(-18, 5);
  });

  it('falls back to equal weights if every reference weight is zero', () => {
    const resolved = resolveReferenceMetrics(-1, [
      { assetId: 'a', report: report({ lufs: -18 }), weight: 0 },
      { assetId: 'b', report: report({ lufs: -12 }), weight: 0 },
    ], 'full');
    expect(resolved.assetIds).toEqual(['a', 'b']);
    expect(resolved.metrics.lufs).toBeCloseTo(-14.04, 1);
  });

  it('keeps explicit per-category reference selection independent of blend weights', () => {
    const resolved = resolveReferenceMetrics(1, [
      { assetId: 'first', report: report({ lufs: -18 }), weight: 100 },
      { assetId: 'second', report: report({ lufs: -9 }), weight: 0 },
    ], 'full');
    expect(resolved.assetIds).toEqual(['second']);
    expect(resolved.metrics.lufs).toBeCloseTo(-9, 5);
  });

  it('reports when a requested chorus section is unavailable and uses full-track data', () => {
    const resolved = resolveReferenceMetrics(-1, [
      { assetId: 'has-chorus', report: report({ lufs: -18, chorus: true }) },
      { assetId: 'no-chorus', report: report({ lufs: -12 }) },
    ], 'chorus');
    expect(resolved.fallbackAssetIds).toEqual(['no-chorus']);
    expect(Number.isFinite(resolved.metrics.lufs)).toBe(true);
  });

  it('reduces category agreement when references disagree', () => {
    const aligned = resolveReferenceMetrics(-1, [
      { assetId: 'a', report: report({ width: -10, punch: 0.5 }) },
      { assetId: 'b', report: report({ width: -10, punch: 0.5 }) },
    ], 'full');
    const divergent = resolveReferenceMetrics(-1, [
      { assetId: 'a', report: report({ width: -22, punch: 0.1 }) },
      { assetId: 'b', report: report({ width: -2, punch: 0.95 }) },
    ], 'full');
    expect(divergent.agreement.stereoWidth).toBeLessThan(aligned.agreement.stereoWidth);
    expect(divergent.agreement.punch).toBeLessThan(aligned.agreement.punch);
  });
});

describe('reference-match pre-limiter peak estimate', () => {
  it('adds a broadband gain change to the measured source true peak', () => {
    expect(estimatePreLimiterTruePeak(-6.2, 2.5)).toBeCloseTo(-3.7, 8);
    expect(estimatePreLimiterTruePeak(-3.1, -1.4)).toBeCloseTo(-4.5, 8);
  });

  it('does not clamp an estimate to the selected limiter ceiling', () => {
    expect(estimatePreLimiterTruePeak(-0.4, 1.2)).toBeCloseTo(0.8, 8);
  });

  it('rejects invalid measurements rather than propagating NaN', () => {
    expect(() => estimatePreLimiterTruePeak(Number.NaN, 1)).toThrow(RangeError);
    expect(() => estimatePreLimiterTruePeak(-1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
