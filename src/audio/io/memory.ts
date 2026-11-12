export interface AudioMemoryBuffer {
  L: Float32Array;
  R: Float32Array;
  peaks?: Float32Array;
}

export interface ProjectAudioMemoryEstimate {
  assetCount: number;
  missingAssetCount: number;
  decodedPcmBytes: number;
  waveformBytes: number;
  playbackCopyBytes: number;
  estimatedResidentBytes: number;
  largestAssetPcmBytes: number;
}

/**
 * Estimate the audio-specific working set for one project.
 *
 * This deliberately excludes browser decoder internals, source File/Blob
 * caching, analysis-worker scratch, export buffers, React history and other
 * browser/application overhead. playbackCopyBytes estimates the second PCM
 * copy owned by the AudioWorklet when the project is loaded.
 */
export function estimateProjectAudioMemory(
  assetIds: string[],
  buffers: Record<string, AudioMemoryBuffer | undefined>,
): ProjectAudioMemoryEstimate {
  const uniqueIds = [...new Set(assetIds)];
  let decodedPcmBytes = 0;
  let waveformBytes = 0;
  let largestAssetPcmBytes = 0;
  let missingAssetCount = 0;

  for (const id of uniqueIds) {
    const buffer = buffers[id];
    if (!buffer) {
      missingAssetCount++;
      continue;
    }
    const pcmBytes = buffer.L.byteLength + buffer.R.byteLength;
    decodedPcmBytes += pcmBytes;
    waveformBytes += buffer.peaks?.byteLength ?? 0;
    largestAssetPcmBytes = Math.max(largestAssetPcmBytes, pcmBytes);
  }

  const playbackCopyBytes = decodedPcmBytes;
  return {
    assetCount: uniqueIds.length,
    missingAssetCount,
    decodedPcmBytes,
    waveformBytes,
    playbackCopyBytes,
    estimatedResidentBytes: decodedPcmBytes + playbackCopyBytes + waveformBytes,
    largestAssetPcmBytes,
  };
}

export function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const shown = value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1);
  return shown + ' ' + units[exponent];
}
