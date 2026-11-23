/**
 * Copies a rendered block into the final timeline-aligned output, dropping the
 * renderer's leading latency without allocating intermediate full-song PCM.
 */
export function copyLatencyAlignedBlock(
  blockL: Float32Array,
  blockR: Float32Array,
  frameCount: number,
  renderedFrameOffset: number,
  latency: number,
  outputL: Float32Array,
  outputR: Float32Array,
): number {
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 0 ||
    frameCount > blockL.length ||
    frameCount > blockR.length
  ) {
    throw new RangeError('Invalid offline render block length.');
  }
  if (!Number.isInteger(renderedFrameOffset) || renderedFrameOffset < 0) {
    throw new RangeError('Invalid offline render frame offset.');
  }
  if (!Number.isInteger(latency) || latency < 0) {
    throw new RangeError('Invalid renderer latency.');
  }

  const sourceOffset = Math.max(0, latency - renderedFrameOffset);
  const outputOffset = Math.max(0, renderedFrameOffset - latency);
  const availableFrames = frameCount - sourceOffset;
  const copyFrames = Math.min(
    availableFrames,
    outputL.length - outputOffset,
    outputR.length - outputOffset,
  );

  if (copyFrames <= 0) return 0;

  outputL.set(blockL.subarray(sourceOffset, sourceOffset + copyFrames), outputOffset);
  outputR.set(blockR.subarray(sourceOffset, sourceOffset + copyFrames), outputOffset);
  return copyFrames;
}
