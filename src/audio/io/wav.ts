/**
 * WAV / AIFF container parsing and writing.
 *
 * Decoding itself is delegated to the browser (decodeAudioData), which supports
 * WAV, AIFF, FLAC, MP3, AAC/M4A and OGG without quality loss beyond the file's
 * own encoding. These parsers read the headers so the app can display truthful
 * sample rate, bit depth and channel counts instead of guessing.
 */

export interface AudioHeaderInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number | null;
  lengthFrames: number | null;
  format: string;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function parseWavHeader(buffer: ArrayBuffer): AudioHeaderInfo | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) return null;
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth: number | null = null;
  let lengthFrames: number | null = null;
  let format = 'WAV';

  while (offset + 8 <= buffer.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (id === 'fmt ') {
      const audioFormat = view.getUint16(dataStart, true);
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      bitDepth = view.getUint16(dataStart + 14, true);
      if (audioFormat === 3) {
        format = 'WAV (float)';
        bitDepth = view.getUint16(dataStart + 14, true);
      } else if (audioFormat === 0xfffe) {
        format = 'WAV (extensible)';
      }
    } else if (id === 'data') {
      lengthFrames = Math.floor(size / Math.max(1, channels * ((bitDepth ?? 16) / 8)));
      break;
    }
    offset = dataStart + size + (size % 2);
  }
  if (!sampleRate || !channels) return null;
  return { sampleRate, channels, bitDepth, lengthFrames, format };
}

function readExtendedFloat(view: DataView, offset: number): number {
  const first = view.getUint16(offset, false);
  const sign = first & 0x8000 ? -1 : 1;
  const expField = first & 0x7fff;
  const hi = view.getUint32(offset + 2, false);
  const lo = view.getUint32(offset + 6, false);
  if (expField === 0 && hi === 0 && lo === 0) return 0;
  // 80-bit extended: explicit integer bit plus 63 fraction bits.
  const mantissa = hi / Math.pow(2, 31) + lo / Math.pow(2, 63);
  return sign * mantissa * Math.pow(2, expField - 16383);
}

function writeExtendedFloat(view: DataView, offset: number, value: number): void {
  // 80-bit IEEE 754 extended precision, as required by AIFF.
  let v = value;
  let sign = 0;
  if (v < 0) {
    sign = 0x8000;
    v = -v;
  }
  if (v === 0 || !Number.isFinite(v)) {
    view.setUint16(offset, 0, false);
    view.setUint32(offset + 2, 0, false);
    view.setUint32(offset + 6, 0, false);
    return;
  }
  const exponent = Math.floor(Math.log2(v));
  const mantissa = v / Math.pow(2, exponent); // [1, 2)
  const scaled = mantissa * Math.pow(2, 63); // explicit integer bit at bit 63
  const hi = Math.floor(scaled / Math.pow(2, 32)) >>> 0;
  const lo = scaled % Math.pow(2, 32) >>> 0;
  view.setUint16(offset, sign | (exponent + 16383), false);
  view.setUint32(offset + 2, hi, false);
  view.setUint32(offset + 6, lo, false);
}

export function parseAiffHeader(buffer: ArrayBuffer): AudioHeaderInfo | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 54) return null;
  if (readAscii(view, 0, 4) !== 'FORM') return null;
  const formType = readAscii(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, false);
    const dataStart = offset + 8;
    if (id === 'COMM') {
      const channels = view.getUint16(dataStart, false);
      const frames = view.getUint32(dataStart + 2, false);
      const bitDepth = view.getUint16(dataStart + 6, false);
      const sampleRate = readExtendedFloat(view, dataStart + 8);
      return {
        sampleRate: Math.round(sampleRate),
        channels,
        bitDepth,
        lengthFrames: frames,
        format: formType === 'AIFC' ? 'AIFF-C' : 'AIFF',
      };
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

export function parseFlacHeader(buffer: ArrayBuffer): AudioHeaderInfo | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 42) return null;
  if (readAscii(view, 0, 4) !== 'fLaC') return null;
  // STREAMINFO block: 4-byte header, then 34 bytes.
  const blockType = view.getUint8(4) & 0x7f;
  if (blockType !== 0) return null;
  const byte10 = view.getUint8(18);
  const byte11 = view.getUint8(19);
  const byte12 = view.getUint8(20);
  const sampleRate = (byte10 << 12) | (byte11 << 4) | (byte12 >> 4);
  const channels = ((byte12 >> 1) & 0x07) + 1;
  const bitDepth = (((byte12 & 0x01) << 4) | (view.getUint8(21) >> 4)) + 1;
  const totalSamples =
    (view.getUint8(21) & 0x0f) * Math.pow(2, 32) +
    view.getUint32(22, false) +
    view.getUint8(26) / 256;
  return {
    sampleRate,
    channels,
    bitDepth,
    lengthFrames: Math.round(totalSamples),
    format: 'FLAC',
  };
}

export function detectHeader(buffer: ArrayBuffer): AudioHeaderInfo | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  const magic = readAscii(view, 0, 4);
  if (magic === 'RIFF') {
    const riffType = readAscii(view, 8, 4);
    if (riffType === 'WAVE') return parseWavHeader(buffer);
    return null;
  }
  if (magic === 'FORM') return parseAiffHeader(buffer);
  if (magic === 'fLaC') return parseFlacHeader(buffer);
  if (readAscii(view, 0, 3) === 'ID3') return { sampleRate: 0, channels: 0, bitDepth: null, lengthFrames: null, format: 'MP3' };
  if (readAscii(view, 0, 4) === 'OggS') return { sampleRate: 0, channels: 0, bitDepth: null, lengthFrames: null, format: 'OGG' };
  const brand = readAscii(view, 4, 4);
  if (brand === 'ftyp') return { sampleRate: 0, channels: 0, bitDepth: null, lengthFrames: null, format: 'AAC / M4A' };
  return null;
}

export type WavBitDepth = 16 | 24 | 32;

export interface EncodeOptions {
  sampleRate: number;
  bitDepth: WavBitDepth;
  /** TPDF dither is applied only when reducing to 16 or 24 bit. */
  dither: boolean;
  metadata?: { title?: string; artist?: string; comment?: string; software?: string };
}

function asciiChunk(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const pad = bytes.length % 2 === 0 ? 0 : 1;
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes);
  return out;
}

/** Write a RIFF/WAVE file. PCM 16/24-bit or IEEE float 32-bit. */
export function encodeWav(L: Float32Array, R: Float32Array, options: EncodeOptions): Blob {
  const channels = 2;
  const frames = Math.min(L.length, R.length);
  const bytesPerSample = options.bitDepth / 8;
  const dataSize = frames * channels * bytesPerSample;
  const metaEntries: [string, string][] = [];
  if (options.metadata?.title) metaEntries.push(['INAM', options.metadata.title]);
  if (options.metadata?.artist) metaEntries.push(['IART', options.metadata.artist]);
  if (options.metadata?.comment) metaEntries.push(['ICMT', options.metadata.comment]);
  if (options.metadata?.software) metaEntries.push(['ISFT', options.metadata.software]);
  let infoSize = 0;
  const infoChunks = metaEntries.map(([id, value]) => {
    const data = asciiChunk(value);
    infoSize += 8 + data.length;
    return { id, data };
  });
  const hasInfo = infoChunks.length > 0;
  const infoTotal = hasInfo ? 12 + infoSize : 0;
  const headerSize = 44 + infoTotal;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeAscii = (text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    offset += text.length;
  };

  writeAscii('RIFF');
  view.setUint32(offset, 36 + dataSize + infoTotal, true);
  offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, options.bitDepth === 32 ? 3 : 1, true);
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, options.sampleRate, true);
  offset += 4;
  view.setUint32(offset, options.sampleRate * channels * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, channels * bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, options.bitDepth, true);
  offset += 2;
  if (hasInfo) {
    writeAscii('LIST');
    view.setUint32(offset, 4 + infoSize, true);
    offset += 4;
    writeAscii('INFO');
    for (const chunk of infoChunks) {
      writeAscii(chunk.id);
      view.setUint32(offset, chunk.data.length, true);
      offset += 4;
      new Uint8Array(buffer, offset, chunk.data.length).set(chunk.data);
      offset += chunk.data.length;
    }
  }
  writeAscii('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const peak = Math.max(1e-9, maxAbs(L, R));
  const normalize = options.bitDepth === 32 ? 1 : 1;
  const scale = 0x7fffffff * normalize;
  let rngState = 0x12345678;
  const rand = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) / 4294967296) * 2 - 1;
  };

  if (options.bitDepth === 16 || options.bitDepth === 24) {
    const quantScale = options.bitDepth === 16 ? 32767 : 8388607;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const src = ch === 0 ? L[i] : R[i];
        let dither = 0;
        if (options.dither) dither = (rand() + rand()) / quantScale;
        const sample = Math.max(-1, Math.min(1, src + dither));
        const value = Math.round(sample * quantScale);
        if (options.bitDepth === 16) {
          view.setInt16(offset, value, true);
          offset += 2;
        } else {
          view.setUint8(offset, value & 0xff);
          view.setUint8(offset + 1, (value >> 8) & 0xff);
          view.setUint8(offset + 2, (value >> 16) & 0xff);
          offset += 3;
        }
      }
    }
  } else {
    for (let i = 0; i < frames; i++) {
      view.setFloat32(offset, L[i], true);
      offset += 4;
      view.setFloat32(offset, R[i], true);
      offset += 4;
    }
  }
  void peak;
  void scale;
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Write an AIFF file (big-endian PCM). Supports 16 and 24-bit only. */
export function encodeAiff(L: Float32Array, R: Float32Array, sampleRate: number, bitDepth: 16 | 24): Blob {
  const frames = Math.min(L.length, R.length);
  const bytesPerSample = bitDepth / 8;
  const dataSize = frames * 2 * bytesPerSample;
  const commSize = 18;
  const ssndSize = 8 + dataSize;
  const total = 12 + 8 + commSize + 8 + ssndSize;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  let offset = 0;
  const ascii = (text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    offset += text.length;
  };
  ascii('FORM');
  view.setUint32(offset, total - 8, false);
  offset += 4;
  ascii('AIFF');
  ascii('COMM');
  view.setUint32(offset, commSize, false);
  offset += 4;
  view.setUint16(offset, 2, false);
  offset += 2;
  view.setUint32(offset, frames, false);
  offset += 4;
  view.setUint16(offset, bitDepth, false);
  offset += 2;
  writeExtendedFloat(view, offset, sampleRate);
  offset += 10;
  ascii('SSND');
  view.setUint32(offset, ssndSize, false);
  offset += 4;
  view.setUint32(offset, 0, false);
  offset += 4;
  view.setUint32(offset, 0, false);
  offset += 4;
  const quant = bitDepth === 16 ? 32767 : 8388607;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const src = ch === 0 ? L[i] : R[i];
      const value = Math.round(Math.max(-1, Math.min(1, src)) * quant);
      if (bitDepth === 16) {
        view.setInt16(offset, value, false);
        offset += 2;
      } else {
        view.setUint8(offset, (value >> 16) & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, value & 0xff);
        offset += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/aiff' });
}

function maxAbs(L: Float32Array, R: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  return peak;
}
