import { describe, expect, it } from 'vitest';
import { ProjectRenderer } from './renderer';
import { createBus, createClip, createProcessorNode, createProject, createTrack } from '../model/defaults';
import type { EngineAsset } from './renderer';

function sineAsset(id: string, amplitude: number, sampleRate: number, length: number): EngineAsset {
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    L[i] = sample;
    R[i] = sample;
  }
  return { id, length, sampleRate, L, R };
}

describe('ProjectRenderer external sidechain routing', () => {
  it('routes a track key into a bus compressor and clears it when disconnected', () => {
    const sampleRate = 48000;
    const blockSize = 128;
    const assetLength = 32768;
    const targetAsset = sineAsset('target', 0.05, sampleRate, assetLength);
    const keyAsset = sineAsset('key', 0.8, sampleRate, assetLength);

    const project = createProject('Sidechain routing test', sampleRate);
    const target = createTrack('audio', 'Target', 0);
    const key = createTrack('audio', 'Key', 1);
    const bus = createBus('Drum Bus', 0);

    target.output = bus.id;
    target.clips.push(createClip(targetAsset.id, assetLength / sampleRate));
    // The key remains audible to the detector but effectively silent in the mix.
    key.volumeDb = -120;
    key.clips.push(createClip(keyAsset.id, assetLength / sampleRate));

    const compressor = createProcessorNode('compressor', {
      threshold: -24,
      ratio: 10,
      attack: 0.1,
      release: 10,
      knee: 0,
      style: 0,
      scHpf: 20,
      lookahead: 0,
      mix: 100,
      makeup: 0,
      autoMakeup: 0,
      link: 100,
    });
    compressor.sidechainFrom = key.id;
    bus.processors.push(compressor);
    project.tracks = [target, key];
    project.buses = [bus];

    const renderer = new ProjectRenderer();
    renderer.configure(project, [targetAsset, keyAsset], sampleRate, blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);

    for (let block = 0; block < 32; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }
    const linkedReduction = renderer.meterSnapshot()[bus.id]?.[compressor.id]?.reduction ?? 0;

    // Disconnecting the key must return the bus compressor to its own detector.
    compressor.sidechainFrom = null;
    renderer.setProject(project);
    for (let block = 32; block < 64; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }
    const internalReduction = renderer.meterSnapshot()[bus.id]?.[compressor.id]?.reduction ?? 0;

    expect(linkedReduction).toBeGreaterThan(3);
    expect(internalReduction).toBeLessThan(1);
  });
});


describe('ProjectRenderer paired master audition', () => {
  it('renders a common track/bus graph once and applies the two master stages independently', () => {
    const sampleRate = 48000;
    const asset = sineAsset('paired-audition', 0.3, sampleRate, 8192);
    const projectA = createProject('Paired audition', sampleRate);
    const track = createTrack('audio', 'Source', 0);
    track.clips.push(createClip(asset.id, asset.length / sampleRate));
    projectA.tracks = [track];
    const projectB = JSON.parse(JSON.stringify(projectA)) as typeof projectA;
    projectB.master.volumeDb = -6;

    const pairedA = new ProjectRenderer();
    const pairedB = new ProjectRenderer();
    pairedA.configure(projectA, [asset], sampleRate, 128);
    pairedB.configure(projectB, [asset], sampleRate, 128);
    expect(pairedA.canSharePreMasterWith(pairedB)).toBe(true);

    const baselineA = new ProjectRenderer();
    const baselineB = new ProjectRenderer();
    baselineA.configure(projectA, [asset], sampleRate, 128);
    baselineB.configure(projectB, [asset], sampleRate, 128);

    for (let block = 0; block < 8; block++) {
      const position = block * 128;
      const aL = new Float32Array(128);
      const aR = new Float32Array(128);
      const bL = new Float32Array(128);
      const bR = new Float32Array(128);
      const expectedAL = new Float32Array(128);
      const expectedAR = new Float32Array(128);
      const expectedBL = new Float32Array(128);
      const expectedBR = new Float32Array(128);

      expect(pairedA.renderPairedBlock(pairedB, position, 128, aL, aR, bL, bR)).toBe(true);
      baselineA.renderBlock(position, 128, expectedAL, expectedAR);
      baselineB.renderBlock(position, 128, expectedBL, expectedBR);

      for (let i = 0; i < 128; i++) {
        expect(aL[i]).toBeCloseTo(expectedAL[i], 6);
        expect(aR[i]).toBeCloseTo(expectedAR[i], 6);
        expect(bL[i]).toBeCloseTo(expectedBL[i], 6);
        expect(bR[i]).toBeCloseTo(expectedBR[i], 6);
      }
    }
  });

  it('refuses to share when any track or bus state differs', () => {
    const sampleRate = 48000;
    const asset = sineAsset('paired-guard', 0.2, sampleRate, 4096);
    const projectA = createProject('Paired guard', sampleRate);
    const trackA = createTrack('audio', 'Source', 0);
    trackA.clips.push(createClip(asset.id, asset.length / sampleRate));
    projectA.tracks = [trackA];
    const projectB = JSON.parse(JSON.stringify(projectA)) as typeof projectA;
    projectB.tracks[0].volumeDb = -3;

    const rendererA = new ProjectRenderer();
    const rendererB = new ProjectRenderer();
    rendererA.configure(projectA, [asset], sampleRate, 128);
    rendererB.configure(projectB, [asset], sampleRate, 128);

    expect(rendererA.canSharePreMasterWith(rendererB)).toBe(false);
    const output = new Float32Array(128);
    expect(rendererA.renderPairedBlock(
      rendererB, 0, 128,
      output, new Float32Array(128), new Float32Array(128), new Float32Array(128),
    )).toBe(false);
  });
});
