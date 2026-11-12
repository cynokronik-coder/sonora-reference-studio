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

describe('ProjectRenderer compressor latency compensation', () => {
  it('aligns a dry track with a compressor using lookahead', () => {
    const sampleRate = 48_000;
    const assetLength = 512;
    const impulseL = new Float32Array(assetLength);
    const impulseR = new Float32Array(assetLength);
    impulseL[0] = impulseR[0] = 1;
    const asset: EngineAsset = {
      id: 'impulse',
      length: assetLength,
      sampleRate,
      L: impulseL,
      R: impulseR,
    };

    const compressed = createTrack('audio', 'Lookahead', 0);
    compressed.clips.push(createClip(asset.id, assetLength / sampleRate));
    compressed.processors.push(createProcessorNode('compressor', {
      threshold: -60,
      ratio: 1,
      lookahead: 4,
    }));
    const dry = createTrack('audio', 'Dry', 1);
    dry.clips.push(createClip(asset.id, assetLength / sampleRate));

    const project = createProject('Compressor latency compensation', sampleRate);
    project.tracks = [compressed, dry];
    const renderer = new ProjectRenderer();
    renderer.configure(project, [asset], sampleRate, 128);
    expect(renderer.totalLatency).toBe(192);

    const renderedL = new Float32Array(512);
    const renderedR = new Float32Array(512);
    for (let offset = 0; offset < renderedL.length; offset += 128) {
      renderer.renderBlock(offset, 128, renderedL.subarray(offset, offset + 128), renderedR.subarray(offset, offset + 128));
    }

    expect(renderedL[192]).toBeCloseTo(2, 6);
    expect(renderedR[192]).toBeCloseTo(2, 6);
    expect(renderedL.slice(0, 192).every((sample) => sample === 0)).toBe(true);
  });
});
