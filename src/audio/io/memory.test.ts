import { describe, expect, it } from 'vitest';
import { estimateProjectAudioMemory, formatMemoryBytes } from './memory';

describe('project audio memory estimate', () => {
  it('counts unique active assets and the expected playback copy', () => {
    const buffers = {
      a: {
        L: new Float32Array(100),
        R: new Float32Array(100),
        peaks: new Float32Array(20),
      },
      b: {
        L: new Float32Array(50),
        R: new Float32Array(50),
        peaks: new Float32Array(10),
      },
    };

    const estimate = estimateProjectAudioMemory(['a', 'b', 'a'], buffers);

    expect(estimate.assetCount).toBe(2);
    expect(estimate.missingAssetCount).toBe(0);
    expect(estimate.decodedPcmBytes).toBe((100 + 100 + 50 + 50) * 4);
    expect(estimate.waveformBytes).toBe((20 + 10) * 4);
    expect(estimate.playbackCopyBytes).toBe(estimate.decodedPcmBytes);
    expect(estimate.estimatedResidentBytes).toBe(
      estimate.decodedPcmBytes * 2 + estimate.waveformBytes,
    );
  });

  it('reports missing buffers without inventing their size', () => {
    const estimate = estimateProjectAudioMemory(['missing'], {});

    expect(estimate.assetCount).toBe(1);
    expect(estimate.missingAssetCount).toBe(1);
    expect(estimate.decodedPcmBytes).toBe(0);
    expect(estimate.estimatedResidentBytes).toBe(0);
  });

  it('formats memory values for the Studio status indicator', () => {
    expect(formatMemoryBytes(0)).toBe('0 B');
    expect(formatMemoryBytes(1024)).toBe('1.0 KiB');
    expect(formatMemoryBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatMemoryBytes(1024 ** 3)).toBe('1.0 GiB');
  });
});
