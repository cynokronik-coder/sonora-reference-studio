export function computePeaks(L: Float32Array, R: Float32Array, buckets = 4096): Float32Array {
  const out = new Float32Array(buckets);
  const n = Math.min(L.length, R.length);
  if (n === 0) return out;
  const per = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(n, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

/** Mono preview peaks at a lower resolution, used in track headers. */
export function computeMiniPeaks(L: Float32Array, R: Float32Array, buckets = 240): Float32Array {
  return computePeaks(L, R, buckets);
}

export function peaksToPath(peaks: Float32Array, width: number, height: number): { path: string; } {
  const mid = height / 2;
  const step = width / peaks.length;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = i * step;
    const h = Math.max(0.5, peaks[i] * (height * 0.48));
    top.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(mid - h).toFixed(2)}`);
    bottom.push(`L${x.toFixed(2)},${(mid + h).toFixed(2)}`);
  }
  return { path: top.join(' ') + ' ' + bottom.reverse().join(' ') + 'Z' };
}
