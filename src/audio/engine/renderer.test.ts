import { describe, expect, it } from 'vitest';
import { ProjectRenderer } from './renderer';
import { createBus, createClip, createProcessorNode, createProject, createTrack } from '../model/defaults';
import type { EngineAsset } from './renderer';

function sineAsset(id: string, amplitude: number, sampleRate: number, length: number, frequency = 1000): EngineAsset {
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    L[i] = sample;
    R[i] = sample;
  }
  return { id, length, sampleRate, L, R };
}

describe('ProjectRenderer external sidechain routing', () => {
  it('splits a routed external key into the matching multiband detector', () => {
    const sampleRate = 48000;
    const blockSize = 128;
    const assetLength = 32768;
    const targetAsset = sineAsset('target', 0.05, sampleRate, assetLength, 100);
    const keyAsset = sineAsset('key', 0.8, sampleRate, assetLength, 6000);
    const project = createProject('Multiband sidechain routing test', sampleRate);
    const target = createTrack('audio', 'Target', 0);
    const key = createTrack('audio', 'Key', 1);
    const bus = createBus('Multiband Bus', 0);

    target.output = bus.id;
    target.clips.push(createClip(targetAsset.id, assetLength / sampleRate));
    key.volumeDb = -120;
    key.clips.push(createClip(keyAsset.id, assetLength / sampleRate));

    const multiband = createProcessorNode('multibandComp', {
      xLow: 200,
      xHigh: 2000,
      output: 0,
      ...Object.fromEntries([0, 1, 2].flatMap((band) => [
        [`b${band}_threshold`, -12],
        [`b${band}_ratio`, 10],
        [`b${band}_attack`, 0.1],
        [`b${band}_release`, 10],
        [`b${band}_knee`, 0],
        [`b${band}_style`, 0],
        [`b${band}_link`, 100],
        [`b${band}_mix`, 100],
      ])),
    });
    multiband.sidechainFrom = key.id;
    bus.processors.push(multiband);
    project.tracks = [target, key];
    project.buses = [bus];

    const renderer = new ProjectRenderer();
    renderer.configure(project, [targetAsset, keyAsset], sampleRate, blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    for (let block = 0; block < 32; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }

    const meter = renderer.meterSnapshot()[bus.id]?.[multiband.id];
    const bands = meter?.bands ?? [];
    expect(Math.abs(bands[0] ?? 0)).toBeLessThan(1);
    expect(Math.abs(bands[1] ?? 0)).toBeLessThan(1);
    expect(Math.abs(bands[2] ?? 0)).toBeGreaterThan(3);
  });

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
