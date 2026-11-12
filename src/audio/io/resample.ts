export interface StreamingResampleOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Output frames per cooperative work block. Defaults to 4,096. */
  blockFrames?: number;
}

const PHASE_COUNT = 1024;
const KAISER_BETA = 8.6;
const KAISER_LOOKUP_SIZE = 4096;

function besselI0(value: number): number {
  const quarter = value * value * 0.25;
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 64; k++) {
    term *= quarter / (k * k);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

function createKaiserLookup(): Float64Array {
  const values = new Float64Array(KAISER_LOOKUP_SIZE + 1);
  const denominator = besselI0(KAISER_BETA);
  for (let i = 0; i <= KAISER_LOOKUP_SIZE; i++) {
    const x = i / KAISER_LOOKUP_SIZE;
    values[i] = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - x * x))) / denominator;
  }
  return values;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Sample-rate conversion cancelled.');
  error.name = 'AbortError';
  throw error;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createCoefficientTable(cutoff: number, radius: number): Float32Array {
  const tapCount = radius * 2;
  const coefficients = new Float32Array(PHASE_COUNT * tapCount);
  const window = createKaiserLookup();

  for (let phase = 0; phase < PHASE_COUNT; phase++) {
    const fraction = phase / PHASE_COUNT;
    const offset = phase * tapCount;
    let sum = 0;

    for (let tap = 0; tap < tapCount; tap++) {
      const distance = tap - radius + 1 - fraction;
      const normalizedDistance = Math.min(1, Math.abs(distance) / radius);
      const windowIndex = Math.min(
        KAISER_LOOKUP_SIZE,
        Math.round(normalizedDistance * KAISER_LOOKUP_SIZE),
      );
      const argument = 2 * cutoff * distance;
      const sinc = Math.abs(argument) < 1e-12
        ? 1
        : Math.sin(Math.PI * argument) / (Math.PI * argument);
      const coefficient = 2 * cutoff * sinc * window[windowIndex];
      coefficients[offset + tap] = coefficient;
      sum += coefficient;
    }

    // Normalize each fractional phase independently to preserve DC gain.
    if (Math.abs(sum) > 1e-12) {
      for (let tap = 0; tap < tapCount; tap++) {
        coefficients[offset + tap] /= sum;
      }
    }
  }

  return coefficients;
}

/**
 * Stereo, windowed-sinc sample-rate conversion.
 *
 * Uses a precomputed polyphase Kaiser-windowed low-pass filter and writes
 * directly into the final output channels in bounded blocks. It avoids the
 * intermediate full-length OfflineAudioBuffer and rendered AudioBuffer used
 * by OfflineAudioContext-based conversion. Input and final output PCM still
 * remain resident because the current project/analysis APIs use Float32 arrays.
 */
export async function resampleStereoSinc(
  left: Float32Array,
  right: Float32Array,
  fromRate: number,
  toRate: number,
  options: StreamingResampleOptions = {},
): Promise<{ L: Float32Array; R: Float32Array }> {
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    throw new RangeError('Sample rates must be finite positive numbers.');
  }
  if (left.length !== right.length) {
    throw new RangeError('Stereo channels must have the same number of frames.');
  }
  if (fromRate === toRate) return { L: left, R: right };
  if (left.length === 0) return { L: new Float32Array(0), R: new Float32Array(0) };

  const outputLength = Math.ceil((left.length * toRate) / fromRate);
  if (!Number.isSafeInteger(outputLength) || outputLength < 1 || outputLength > 0xffffffff) {
    throw new RangeError('The requested resampled programme is too large for a typed-array output.');
  }

  // 0.47 cycles/input-sample leaves a transition band below Nyquist. The
  // radius grows inversely with the cutoff so downsampling retains filter
  // support rather than using a short, alias-prone fixed-size kernel.
  const cutoff = 0.47 * Math.min(1, toRate / fromRate);
  const radius = Math.ceil(16 / cutoff);
  const tapCount = radius * 2;
  const coefficients = createCoefficientTable(cutoff, radius);
  const outputL = new Float32Array(outputLength);
  const outputR = new Float32Array(outputLength);
  const blockFrames = Math.max(256, Math.min(16_384, Math.floor(options.blockFrames ?? 4096)));
  const phaseScale = PHASE_COUNT;
  let completed = 0;

  throwIfAborted(options.signal);
  for (let blockStart = 0; blockStart < outputLength; blockStart += blockFrames) {
    throwIfAborted(options.signal);
    const blockEnd = Math.min(outputLength, blockStart + blockFrames);

    for (let outputIndex = blockStart; outputIndex < blockEnd; outputIndex++) {
      const position = (outputIndex * fromRate) / toRate;
      let base = Math.floor(position);
      let phase = Math.floor((position - base) * phaseScale + 0.5);
      if (phase === phaseScale) {
        base++;
        phase = 0;
      }

      const coefficientOffset = phase * tapCount;
      const firstInput = base - radius + 1;
      let sumL = 0;
      let sumR = 0;
      let validWeight = 0;

      for (let tap = 0; tap < tapCount; tap++) {
        const inputIndex = firstInput + tap;
        if (inputIndex < 0 || inputIndex >= left.length) continue;
        const coefficient = coefficients[coefficientOffset + tap];
        sumL += left[inputIndex] * coefficient;
        sumR += right[inputIndex] * coefficient;
        validWeight += coefficient;
      }

      // Renormalize the truncated filter at file boundaries to avoid a DC
      // dip at the beginning/end while retaining zero-extension timing.
      if (Math.abs(validWeight) > 1e-12) {
        sumL /= validWeight;
        sumR /= validWeight;
      }
      outputL[outputIndex] = sumL;
      outputR[outputIndex] = sumR;
    }

    completed = blockEnd;
    options.onProgress?.(completed / outputLength);
    if (completed < outputLength) await yieldToEventLoop();
  }

  throwIfAborted(options.signal);
  return { L: outputL, R: outputR };
}
