import { describe, expect, it } from 'vitest';
import { ProjectRenderer } from '../renderer';
import { allAssetIds } from '../../model/project';
import type { ProjectState, TrackState } from '../../model/types';

const SR = 48000;

function makeAsset(ramp = false): {
  id: string;
  sampleRate: number;
  length: number;
  L: Float32Array;
  R: Float32Array;
} {
  const length = SR * 2;
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const value = ramp ? i / (length - 1) : 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR);
    L[i] = value;
    R[i] = value;
  }
  return { id: 'asset-1', sampleRate: SR, length, L, R };
}

function makeTrack(offset = 0): TrackState {
  return {
    id: 'track-1',
    name: 'Track',
    kind: 'audio',
    color: '#c8f169',
    volumeDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    polarity: false,
    mono: false,
    output: null,
    sends: [],
    processors: [],
    automation: [],
    height: 78,
    clips: [
      {
        id: 'clip-1',
        assetId: 'asset-1',
        start: 0,
        offset,
        duration: 2,
        fadeIn: 0,
        fadeOut: 0,
        gainDb: 0,
      },
    ],
  };
}

function makeProject(track: TrackState): ProjectState {
  return {
    id: 'project-1',
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    sampleRate: SR,
    tempo: 120,
    folder: '',
    notes: '',
    tracks: [track],
    buses: [],
    master: { volumeDb: 0, processors: [] },
    referenceAssetIds: ['asset-1'],
    targetAssetIds: [],
    match: {} as ProjectState['match'],
    masters: [],
    targetLufs: -14,
    targetTruePeak: -1,
    autosave: true,
  };
}

function firstBlockPeak(project: ProjectState, asset: ReturnType<typeof makeAsset>): number {
  const renderer = new ProjectRenderer();
  renderer.configure(project, [asset], SR, 128);
  const L = new Float32Array(128);
  const R = new Float32Array(128);
  renderer.renderBlock(0, 128, L, R);
  let peak = 0;
  for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  return peak;
}

describe('ProjectRenderer clip playback', () => {
  it('renders the clip instead of reading source sample zero', () => {
    expect(firstBlockPeak(makeProject(makeTrack()), makeAsset())).toBeGreaterThan(0.2);
  });

  it('reads the clip offset in seconds', () => {
    const project = makeProject(makeTrack(0.5));
    const renderer = new ProjectRenderer();
    renderer.configure(project, [makeAsset(true)], SR, 128);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    renderer.renderBlock(0, 128, L, R);
    expect(L[0]).toBeCloseTo(0.25, 3);
    expect(R[0]).toBeCloseTo(0.25, 3);
  });

  it('includes assets that only appear in stem clips', () => {
    const track = makeTrack();
    track.kind = 'stem';
    const project = makeProject(track);
    project.referenceAssetIds = [];
    expect(allAssetIds(project)).toContain('asset-1');
  });
});
