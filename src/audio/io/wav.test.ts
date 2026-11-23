import { describe, expect, it } from 'vitest';
import { encodeAiff, encodeWav, parseAiffHeader, parseWavHeader, writeAiffToWritable, writeWavToWritable } from './wav';

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function findChunkDataOffset(bytes: Uint8Array, id: string): number {
  for (let offset = 0; offset <= bytes.length - id.length - 4; offset++) {
    let matches = true;
    for (let i = 0; i < id.length; i++) {
      if (bytes[offset + i] !== id.charCodeAt(i)) {
        matches = false;
        break;
      }
    }
    if (matches) return offset + 8;
  }
  throw new Error(`Chunk "${id}" not found.`);
}

function readSigned24(view: DataView, offset: number, littleEndian: boolean): number {
  const b0 = view.getUint8(offset + (littleEndian ? 0 : 2));
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + (littleEndian ? 2 : 0));
  const value = (b2 << 16) | (b1 << 8) | b0;
  return value & 0x800000 ? value - 0x1000000 : value;
}

describe('chunked WAV encoding', () => {
  it('writes valid 16-bit stereo PCM and preserves INFO metadata', async () => {
    const left = Float32Array.from([-1, -0.5, 0, 0.5, 1]);
    const right = Float32Array.from([1, 0.5, 0, -0.5, -1]);
    const blob = encodeWav(left, right, {
      sampleRate: 48_000,
      bitDepth: 16,
      dither: false,
      metadata: { title: 'Sonora test', artist: 'Studio', comment: 'Round trip', software: 'Sonora' },
    });
    const bytes = await bytesOf(blob);
    const header = parseWavHeader(bytes.buffer as ArrayBuffer);

    expect(blob.type).toBe('audio/wav');
    expect(header).toMatchObject({ sampleRate: 48_000, channels: 2, bitDepth: 16, lengthFrames: 5 });
    const dataOffset = findChunkDataOffset(bytes, 'data');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => view.getInt16(dataOffset + i * 2, true))).toEqual([
      -32767, 32767, -16383, 16384, 0, 0, 16384, -16383, 32767, -32767,
    ]);
    expect(new TextDecoder().decode(bytes)).toContain('Sonora test');
    expect(blob.size).toBe(dataOffset + left.length * 4);
  });

  it('writes 24-bit integer PCM and 32-bit float PCM without changing source samples', async () => {
    const left = Float32Array.from([-1, -0.25, 0.125, 1]);
    const right = Float32Array.from([1, 0.25, -0.125, -1]);

    const pcm24 = await bytesOf(encodeWav(left, right, { sampleRate: 44_100, bitDepth: 24, dither: false }));
    const offset24 = findChunkDataOffset(pcm24, 'data');
    const view24 = new DataView(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength);
    expect(readSigned24(view24, offset24, true)).toBe(-8_388_607);
    expect(readSigned24(view24, offset24 + 3, true)).toBe(8_388_607);

    const float32 = await bytesOf(encodeWav(left, right, { sampleRate: 96_000, bitDepth: 32, dither: true }));
    const offset32 = findChunkDataOffset(float32, 'data');
    const view32 = new DataView(float32.buffer, float32.byteOffset, float32.byteLength);
    expect(view32.getFloat32(offset32, true)).toBe(-1);
    expect(view32.getFloat32(offset32 + 4, true)).toBe(1);
    expect(view32.getFloat32(offset32 + 8, true)).toBe(-0.25);
  });

  it('continues deterministic TPDF dither across chunk boundaries', async () => {
    const frames = 16_384 + 17;
    const left = new Float32Array(frames).fill(0.12345);
    const right = new Float32Array(frames).fill(-0.12345);
    const first = await bytesOf(encodeWav(left, right, { sampleRate: 48_000, bitDepth: 24, dither: true }));
    const second = await bytesOf(encodeWav(left, right, { sampleRate: 48_000, bitDepth: 24, dither: true }));
    expect(first).toEqual(second);
    expect(parseWavHeader(first.buffer as ArrayBuffer)?.lengthFrames).toBe(frames);
    expect(first.length).toBe(44 + frames * 6);
  });

  it('trims unequal channel lengths to the shorter channel', async () => {
    const blob = encodeWav(
      Float32Array.from([0.1, 0.2, 0.3]),
      Float32Array.from([-0.1, -0.2]),
      { sampleRate: 48_000, bitDepth: 32, dither: false },
    );
    const header = parseWavHeader(await blob.arrayBuffer());
    expect(header?.lengthFrames).toBe(2);
  });

  it('rejects invalid sample rates and byte rates before allocating audio chunks', () => {
    expect(() => encodeWav(
      new Float32Array(2),
      new Float32Array(2),
      { sampleRate: 0, bitDepth: 16, dither: false },
    )).toThrow(RangeError);
    expect(() => encodeWav(
      new Float32Array(1),
      new Float32Array(1),
      { sampleRate: 48_000, bitDepth: 16, dither: false },
    )).not.toThrow();
    expect(() => encodeWav(
      new Float32Array(1),
      new Float32Array(1),
      { sampleRate: 3_000_000_000, bitDepth: 16, dither: false },
    )).toThrow(RangeError);
  });
});

describe('chunked AIFF encoding', () => {
  it('writes valid 16-bit big-endian stereo PCM', async () => {
    const left = Float32Array.from([-1, -0.5, 0, 0.5, 1]);
    const right = Float32Array.from([1, 0.5, 0, -0.5, -1]);
    const blob = encodeAiff(left, right, 44_100, 16);
    const bytes = await bytesOf(blob);
    const header = parseAiffHeader(bytes.buffer as ArrayBuffer);
    const dataOffset = findChunkDataOffset(bytes, 'SSND') + 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(blob.type).toBe('audio/aiff');
    expect(header).toMatchObject({ sampleRate: 44_100, channels: 2, bitDepth: 16, lengthFrames: 5 });
    expect(view.getInt16(dataOffset, false)).toBe(-32767);
    expect(view.getInt16(dataOffset + 2, false)).toBe(32767);
    expect(view.getInt16(dataOffset + 4, false)).toBe(-16383);
    expect(view.getInt16(dataOffset + 6, false)).toBe(16384);
    expect(blob.size).toBe(54 + left.length * 4);
  });

  it('writes 24-bit big-endian samples correctly after crossing an encoding block', async () => {
    const frames = 16_384 + 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left[16_384] = -1;
    right[16_384] = 1;
    left[16_385] = 0.5;
    right[16_385] = -0.5;

    const blob = encodeAiff(left, right, 48_000, 24);
    const bytes = await bytesOf(blob);
    const header = parseAiffHeader(bytes.buffer as ArrayBuffer);
    const dataOffset = findChunkDataOffset(bytes, 'SSND') + 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frameOffset = dataOffset + 16_384 * 6;

    expect(header?.lengthFrames).toBe(frames);
    expect(readSigned24(view, frameOffset, false)).toBe(-8_388_607);
    expect(readSigned24(view, frameOffset + 3, false)).toBe(8_388_607);
    expect(readSigned24(view, frameOffset + 6, false)).toBe(4_194_304);
    expect(readSigned24(view, frameOffset + 9, false)).toBe(-4_194_303);
    expect(blob.size).toBe(54 + frames * 6);
  });

  it('rejects an invalid sample rate', () => {
    expect(() => encodeAiff(new Float32Array(1), new Float32Array(1), 0, 16)).toThrow(RangeError);
  });
});


describe('direct-to-file WAV and AIFF writers', () => {
  it('writes byte-identical WAV output sequentially and reports progress', async () => {
    const left = new Float32Array(16_384 + 5);
    const right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.sin(i / 17) * 0.7;
      right[i] = Math.cos(i / 23) * 0.6;
    }
    const written: ArrayBuffer[] = [];
    const progress: number[] = [];
    await writeWavToWritable(
      left,
      right,
      { sampleRate: 48_000, bitDepth: 24, dither: true, metadata: { title: 'Direct write' } },
      { write: async (chunk) => { written.push(chunk.slice(0)); } },
      { onProgress: (value) => progress.push(value) },
    );

    const streamed = new Blob(written, { type: 'audio/wav' });
    const buffered = encodeWav(
      left,
      right,
      { sampleRate: 48_000, bitDepth: 24, dither: true, metadata: { title: 'Direct write' } },
    );
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(
      new Uint8Array(await buffered.arrayBuffer()),
    );
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toHaveLength(3);
  });

  it('writes byte-identical AIFF output sequentially across block boundaries', async () => {
    const left = new Float32Array(16_384 + 9);
    const right = new Float32Array(left.length);
    left[16_384] = -1;
    right[16_384] = 1;
    left[left.length - 1] = 0.5;
    right[right.length - 1] = -0.5;
    const written: ArrayBuffer[] = [];
    await writeAiffToWritable(
      left,
      right,
      44_100,
      24,
      { write: async (chunk) => { written.push(chunk.slice(0)); } },
    );

    const streamed = new Blob(written, { type: 'audio/aiff' });
    const buffered = encodeAiff(left, right, 44_100, 24);
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(
      new Uint8Array(await buffered.arrayBuffer()),
    );
  });

  it('stops before writing further WAV blocks after cancellation', async () => {
    const controller = new AbortController();
    const written: ArrayBuffer[] = [];
    await expect(writeWavToWritable(
      new Float32Array(16_384 + 1),
      new Float32Array(16_384 + 1),
      { sampleRate: 48_000, bitDepth: 16, dither: false },
      { write: async (chunk) => { written.push(chunk.slice(0)); } },
      { signal: controller.signal, onProgress: (progress) => {
        if (progress === 0) controller.abort();
      } },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(written).toHaveLength(1);
    expect(written[0].byteLength).toBe(44);
  });
});
