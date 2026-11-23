/**
 * Fill reusable interleaved-channel scratch buffers with one LAME-compatible
 * signed 16-bit stereo block. Source PCM remains untouched.
 */
export function fillStereoPcm16Block(
  sourceL: Float32Array,
  sourceR: Float32Array,
  sourceOffset: number,
  frameCount: number,
  targetL: Int16Array,
  targetR: Int16Array,
): void {
  if (
    !Number.isInteger(sourceOffset) ||
    sourceOffset < 0 ||
    !Number.isInteger(frameCount) ||
    frameCount < 0 ||
    sourceOffset + frameCount > sourceL.length ||
    sourceOffset + frameCount > sourceR.length ||
    frameCount > targetL.length ||
    frameCount > targetR.length
  ) {
    throw new RangeError('Invalid MP3 conversion block range.');
  }

  for (let i = 0; i < frameCount; i++) {
    targetL[i] = Math.max(-32768, Math.min(32767, Math.round(sourceL[sourceOffset + i] * 32767)));
    targetR[i] = Math.max(-32768, Math.min(32767, Math.round(sourceR[sourceOffset + i] * 32767)));
  }
}
