import { detectHeader, type AudioHeaderInfo } from './wav';
import { resampleStereoSinc, type StreamingResampleOptions } from './resample';

export interface DecodedAudio {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
  header: AudioHeaderInfo | null;
  /** True when the browser had to decode without header information. */
  decodedOnly: boolean;
  warnings: string[];
}

export const SUPPORTED_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm'];
export const SUPPORTED_MIME = [
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aiff',
  'audio/x-aiff',
  'audio/flac',
  'audio/x-flac',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
];

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

/**
 * Validate and decode a user file.
 *
 * The original file bytes are never modified. We decode at the file's native
 * sample rate through an OfflineAudioContext and only then convert to the
 * project rate, so the app never silently resamples high-resolution material.
 */
export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AudioDecodeError(`File is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`);
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!SUPPORTED_EXTENSIONS.includes(extension) && !SUPPORTED_MIME.includes(file.type)) {
    throw new AudioDecodeError(`Unsupported file type ".${extension}". Supported: WAV, AIFF, FLAC, MP3, AAC/M4A, OGG.`);
  }
  const arrayBuffer = await file.arrayBuffer();
  const header = detectHeader(arrayBuffer);
  const warnings: string[] = [];

  const anyWindow = window as unknown as { webkitAudioContext?: typeof AudioContext };
  const AudioCtor = window.AudioContext ?? anyWindow.webkitAudioContext;
  if (!AudioCtor) throw new AudioDecodeError('Web Audio is not available in this browser.');

  const nativeRate = header?.sampleRate && header.sampleRate >= 8000 ? header.sampleRate : 48000;

  let decoded: AudioBuffer;
  try {
    // A one-frame context is enough to decode at the file's native rate; the
    // decoded buffer grows to the file's real length. Allocating a buffer of
    // guessed duration would waste hundreds of MB on long files.
    const ctx = new OfflineAudioContext(2, 1, nativeRate);
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (error) {
    throw new AudioDecodeError(
      `The browser could not decode this file${header?.format ? ` (${header.format})` : ''}. ` +
        'Try WAV, AIFF, FLAC, MP3, AAC/M4A or OGG. ' +
        (error instanceof Error ? `Details: ${error.message}` : ''),
    );
  }

  const length = decoded.length;
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const left = decoded.getChannelData(0);
  L.set(left);
  if (decoded.numberOfChannels > 1) {
    R.set(decoded.getChannelData(1));
  } else {
    R.set(left);
    warnings.push('Mono file duplicated to stereo for processing.');
  }
  const sourcePeak = (() => {
    let p = 0;
    for (let i = 0; i < length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    return p;
  })();
  if (sourcePeak > 1.0) {
    warnings.push('Source exceeds 0 dBFS; values above full scale were preserved in the working buffer.');
  }
  if (header?.sampleRate && header.sampleRate !== decoded.sampleRate) {
    warnings.push(`Browser decoded at ${decoded.sampleRate} Hz instead of the file's ${header.sampleRate} Hz.`);
  }
  if (!header) {
    warnings.push('Header metadata unavailable; duration and rate come from the browser decoder.');
  }

  return {
    L,
    R,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    duration: decoded.duration,
    header,
    decodedOnly: !header || !header.bitDepth,
    warnings,
  };
}

/** Convert decoded channels with bounded, cooperative polyphase sinc processing. */
export async function resampleToRate(
  L: Float32Array,
  R: Float32Array,
  fromRate: number,
  toRate: number,
  options: StreamingResampleOptions = {},
): Promise<{ L: Float32Array; R: Float32Array; quality: string }> {
  if (fromRate === toRate) {
    // Validate rates even on the no-op path.
    if (!Number.isFinite(fromRate) || fromRate <= 0) throw new RangeError('Sample rates must be finite positive numbers.');
    return { L, R, quality: 'none' };
  }
  const converted = await resampleStereoSinc(L, R, fromRate, toRate, options);
  return { ...converted, quality: '1024-phase Kaiser-windowed sinc resampling' };
}

/** Peak amplitude of a decoded buffer. */
export function peakOf(L: Float32Array, R: Float32Array): number {
  let p = 0;
  for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  return p;
}
