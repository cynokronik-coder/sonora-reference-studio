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
  it('routes a raw track key into a master-chain Dynamic EQ', () => {
    const sampleRate = 48000;
    const blockSize = 128;
    const assetLength = 32768;
    const targetAsset = sineAsset('target-dyn-eq', 0.02, sampleRate, assetLength);
    const keyAsset = sineAsset('key-dyn-eq', 0.8, sampleRate, assetLength);
    const project = createProject('Dynamic EQ master sidechain test', sampleRate);
    const target = createTrack('audio', 'Target', 0);
    const key = createTrack('audio', 'Key', 1);
    target.clips.push(createClip(targetAsset.id, assetLength / sampleRate));
    key.volumeDb = -120;
    key.clips.push(createClip(keyAsset.id, assetLength / sampleRate));

    const dynamicEq = createProcessorNode('dynamicEq', {
      b0_on: 1,
      b0_freq: 1_000,
      b0_q: 8,
      b0_threshold: -24,
      b0_ratio: 4,
      b0_knee: 0,
      b0_range: 12,
      b0_attack: 0.1,
      b0_release: 100,
      b0_link: 100,
      b0_mode: 0,
    });
    dynamicEq.sidechainFrom = key.id;
    project.tracks = [target, key];
    project.master.processors.push(dynamicEq);

    const renderer = new ProjectRenderer();
    renderer.configure(project, [targetAsset, keyAsset], sampleRate, blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    for (let block = 0; block < 32; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }

    const meter = renderer.meterSnapshot().master?.[dynamicEq.id];
    expect(meter?.reduction ?? 0).toBeGreaterThan(5);
    expect(Math.abs(meter?.bands?.[0] ?? 0)).toBeGreaterThan(5);
  });

  it('applies processor parameter automation to Dynamic EQ controls', () => {
    const sampleRate = 48000;
    const blockSize = 128;
    const assetLength = 32768;
    const asset = sineAsset('automation-dyn-eq', 0.8, sampleRate, assetLength);
    const project = createProject('Dynamic EQ automation test', sampleRate);
    const track = createTrack('audio', 'Automated EQ', 0);
    track.clips.push(createClip(asset.id, assetLength / sampleRate));
    const dynamicEq = createProcessorNode('dynamicEq', {
      b0_on: 1,
      b0_freq: 1_000,
      b0_q: 8,
      b0_threshold: -20,
      b0_ratio: 20,
      b0_knee: 0,
      b0_range: 18,
      b0_attack: 0.1,
      b0_release: 10,
      b0_link: 100,
      b0_mode: 0,
    });
    track.processors.push(dynamicEq);
    track.automation.push({
      id: 'dynamic-eq-threshold',
      target: 'send',
      processorId: dynamicEq.id,
      param: 'b0_threshold',
      points: [
        { time: 0, value: -20, curve: 0 },
        { time: 0.04, value: 0, curve: 0 },
      ],
      enabled: true,
    });
    project.tracks = [track];

    const renderer = new ProjectRenderer();
    renderer.configure(project, [asset], sampleRate, blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    let activeReduction = 0;
    for (let block = 0; block < 8; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
      activeReduction = renderer.meterSnapshot()[track.id]?.[dynamicEq.id]?.reduction ?? 0;
    }
    for (let block = 8; block < 48; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }
    const releasedReduction = renderer.meterSnapshot()[track.id]?.[dynamicEq.id]?.reduction ?? 0;
    expect(activeReduction).toBeGreaterThan(3);
    expect(releasedReduction).toBeLessThan(0.5);
  });

  it('applies processor parameter automation to bus processors without changing the signal path', () => {
    const sampleRate = 48000;
    const blockSize = 128;
    const assetLength = 32768;
    const asset = sineAsset('bus-automation-dyn-eq', 0.8, sampleRate, assetLength);
    const project = createProject('Bus Dynamic EQ automation test', sampleRate);
    const track = createTrack('audio', 'Bus automation source', 0);
    const bus = createBus('Automated bus', 0);
    track.output = bus.id;
    track.clips.push(createClip(asset.id, assetLength / sampleRate));

    const dynamicEq = createProcessorNode('dynamicEq', {
      b0_on: 1,
      b0_freq: 1_000,
      b0_q: 8,
      b0_threshold: -20,
      b0_ratio: 20,
      b0_knee: 0,
      b0_range: 18,
      b0_attack: 0.1,
      b0_release: 10,
      b0_link: 100,
      b0_mode: 0,
    });
    bus.processors.push(dynamicEq);
    bus.automation.push({
      id: 'bus-dynamic-eq-threshold',
      target: 'send',
      processorId: dynamicEq.id,
      param: 'b0_threshold',
      points: [
        { time: 0, value: -20, curve: 0 },
        { time: 0.04, value: 0, curve: 0 },
      ],
      enabled: true,
    });
    project.tracks = [track];
    project.buses = [bus];

    const renderer = new ProjectRenderer();
    renderer.configure(project, [asset], sampleRate, blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    let activeReduction = 0;
    for (let block = 0; block < 8; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
      activeReduction = renderer.meterSnapshot()[bus.id]?.[dynamicEq.id]?.reduction ?? 0;
    }
    for (let block = 8; block < 48; block++) {
      renderer.renderBlock(block * blockSize, blockSize, outL, outR);
    }
    const releasedReduction = renderer.meterSnapshot()[bus.id]?.[dynamicEq.id]?.reduction ?? 0;
    expect(activeReduction).toBeGreaterThan(3);
    expect(releasedReduction).toBeLessThan(0.5);
  });

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



describe('ProjectRenderer limiter latency compensation', () => {
  it('aligns a dry track with limiter look-ahead and reports the current engine latency', () => {
    const sampleRate = 48_000;
    const assetLength = 2_048;
    const impulseL = new Float32Array(assetLength);
    const impulseR = new Float32Array(assetLength);
    const impulseAt = 1_200;
    impulseL[impulseAt] = impulseR[impulseAt] = 1;
    const asset: EngineAsset = {
      id: 'limiter-impulse',
      length: assetLength,
      sampleRate,
      L: impulseL,
      R: impulseR,
    };

    const limited = createTrack('audio', 'Look-ahead limiter', 0);
    limited.clips.push(createClip(asset.id, assetLength / sampleRate));
    const limiter = createProcessorNode('limiter', {
      input: 0, ceiling: 0, release: 80, lookahead: 4, truePeak: 0, output: 0,
    });
    limited.processors.push(limiter);
    const dry = createTrack('audio', 'Dry', 1);
    dry.clips.push(createClip(asset.id, assetLength / sampleRate));

    const project = createProject('Limiter latency compensation', sampleRate);
    project.tracks = [limited, dry];
    const renderer = new ProjectRenderer();
    renderer.configure(project, [asset], sampleRate, 128);
    expect(renderer.totalLatency).toBe(192);

    const renderedL = new Float32Array(assetLength);
    const renderedR = new Float32Array(assetLength);
    for (let offset = 0; offset < assetLength; offset += 128) {
      renderer.renderBlock(
        offset, 128,
        renderedL.subarray(offset, offset + 128),
        renderedR.subarray(offset, offset + 128),
      );
    }
    const alignedImpulseAt = impulseAt + 192;
    expect(renderedL.slice(0, alignedImpulseAt).every((sample) => sample === 0)).toBe(true);
    expect(renderedR.slice(0, alignedImpulseAt).every((sample) => sample === 0)).toBe(true);
    // The limiter's 20 ms ceiling ramp has settled before this later impulse.
    expect(renderedL[alignedImpulseAt]).toBeCloseTo(2, 6);
    expect(renderedR[alignedImpulseAt]).toBeCloseTo(2, 6);

    limiter.params.lookahead = 0;
    renderer.setProject(project);
    expect(renderer.totalLatency).toBe(0);
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
    pairedB.configureMasterOnly(projectB, [asset], sampleRate, 128);
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
