import { useEffect, useRef, useState } from 'react';
import type { BandLevel } from '../audio/analysis/spectrum';
import { BAND_CENTERS } from '../audio/analysis/spectrum';
import type { LoudnessPoint } from '../audio/analysis/loudness';
import { ParametricEq } from '../audio/dsp/processors/eq';
import type { ParamValues } from '../audio/dsp/types';
import { clamp, formatTime, gainToDb } from '../audio/dsp/util';
import { realtimeHost, type RealtimeMeters } from '../audio/engine/realtime';

/** Subscribe to the engine's meter stream without re-rendering the whole app. */
export function useMeters(): RealtimeMeters {
  const [payload, setPayload] = useState<RealtimeMeters>(realtimeHost.lastPayload);
  useEffect(() => realtimeHost.onMeters((meters) => setPayload(meters)), []);
  return payload;
}

function useCanvas(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 400;
    const height = parent?.clientHeight ?? 100;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function Waveform({
  peaks,
  duration,
  position,
  loopStart,
  loopEnd,
  loopEnabled,
  onSeek,
  height = 120,
  color = '#c8f169',
  faded,
  label,
}: {
  peaks: Float32Array | null;
  duration: number;
  position: number;
  loopStart?: number;
  loopEnd?: number;
  loopEnabled?: boolean;
  onSeek?: (seconds: number) => void;
  height?: number;
  color?: string;
  faded?: boolean;
  label?: string;
}) {
  const canvasRef = useCanvas(
    (ctx, width, h) => {
      ctx.clearRect(0, 0, width, h);
      const mid = h / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      if (loopEnabled && loopStart !== undefined && loopEnd !== undefined && duration > 0) {
        const x1 = (loopStart / duration) * width;
        const x2 = (loopEnd / duration) * width;
        ctx.fillStyle = 'rgba(200,241,105,0.06)';
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
        ctx.fillStyle = 'rgba(200,241,105,0.4)';
        ctx.fillRect(x1, 0, 1, h);
        ctx.fillRect(x2 - 1, 0, 1, h);
      }
      if (peaks && peaks.length) {
        const perPixel = peaks.length / width;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, faded ? 'rgba(134,144,158,0.55)' : color);
        grad.addColorStop(0.5, faded ? 'rgba(134,144,158,0.8)' : color);
        grad.addColorStop(1, faded ? 'rgba(134,144,158,0.55)' : color);
        ctx.fillStyle = grad;
        for (let x = 0; x < width; x++) {
          let peak = 0;
          const from = Math.floor(x * perPixel);
          const to = Math.max(from + 1, Math.floor((x + 1) * perPixel));
          for (let i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, peaks[i]);
          const bh = Math.max(0.7, peak * mid * 1.75);
          ctx.fillRect(x, mid - bh, 1, bh * 2);
        }
      } else {
        ctx.fillStyle = 'rgba(134,144,158,0.25)';
        ctx.fillRect(0, mid, width, 1);
      }
      if (duration > 0) {
        const x = clamp(position / duration, 0, 1) * width;
        ctx.fillStyle = '#f2f5f8';
        ctx.fillRect(x - 0.5, 0, 1.2, h);
        ctx.fillStyle = 'rgba(242,245,248,0.14)';
        ctx.fillRect(x - 2, 0, 4, 6);
      }
      if (label) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(label, 8, 14);
      }
    },
    [peaks, duration, position, loopStart, loopEnd, loopEnabled, height, color, faded, label],
  );

  return (
    <div className="wave-grid relative w-full overflow-hidden rounded border border-ink-700 bg-ink-950" style={{ height }}>
      <canvas
        ref={canvasRef}
        className={onSeek ? 'cursor-crosshair' : ''}
        onClick={(event) => {
          if (!onSeek || !duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(((event.clientX - rect.left) / rect.width) * duration);
        }}
      />
    </div>
  );
}

export function LevelMeter({ db, height = 96, width = 8, peakDb }: { db: number; height?: number; width?: number; peakDb?: number }) {
  const normalized = clamp((db + 60) / 60, 0, 1);
  const peakNorm = peakDb !== undefined ? clamp((peakDb + 60) / 60, 0, 1) : null;
  const color = db > -1 ? '#f2657a' : db > -6 ? '#f0b45a' : '#c8f169';
  return (
    <div className="relative overflow-hidden rounded-sm bg-ink-900 ring-1 ring-inset ring-ink-700" style={{ height, width }}>
      <div
        className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
        style={{ height: `${normalized * 100}%`, background: `linear-gradient(to top, ${color}55, ${color})` }}
      />
      {peakNorm !== null && (
        <div className="absolute left-0 right-0 h-px bg-white/80" style={{ bottom: `${peakNorm * 100}%` }} />
      )}
      <div className="pointer-events-none absolute inset-0 flex flex-col-reverse justify-between py-0.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-px w-full bg-ink-950/60" />
        ))}
      </div>
    </div>
  );
}

export function GainReductionMeter({ reductionDb, height = 96 }: { reductionDb: number; height?: number }) {
  const amount = clamp(-reductionDb / 20, 0, 1);
  return (
    <div className="relative overflow-hidden rounded-sm bg-ink-900 ring-1 ring-inset ring-ink-700" style={{ height, width: 6 }}>
      <div
        className="absolute left-0 right-0 top-0 bg-signal-amber/80 transition-[height] duration-75"
        style={{ height: `${amount * 100}%` }}
      />
    </div>
  );
}

export function MiniMeter({ db, width = 60 }: { db: number; width?: number }) {
  const norm = clamp((db + 60) / 60, 0, 1);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-ink-800" style={{ width }}>
      <div
        className="h-full bg-accent transition-[width] duration-75"
        style={{ width: `${norm * 100}%` }}
      />
    </div>
  );
}

const bandX = (center: number, width: number) => {
  const log = Math.log2(clamp(center, 20, 20000) / 20) / Math.log2(1000);
  return log * width;
};

function smoothPath(values: number[], width: number, height: number, minDb: number, maxDb: number): string {
  if (!values.length) return '';
  const points = values.map((v, i) => {
    const x = bandX(BAND_CENTERS[i] ?? 20, width);
    const y = height - ((clamp(v, minDb, maxDb) - minDb) / (maxDb - minDb)) * height;
    return [x, y] as const;
  });
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export function BandChart({
  bands,
  compare,
  height = 160,
  maxDb = 6,
  minDb = -36,
  color = '#c8f169',
  compareColor = '#5ad1e6',
  label,
  compareLabel,
}: {
  bands: number[];
  compare?: number[];
  height?: number;
  maxDb?: number;
  minDb?: number;
  color?: string;
  compareColor?: string;
  label?: string;
  compareLabel?: string;
}) {
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const path = smoothPath(bands, width, height, minDb, maxDb);
  const comparePath = compare ? smoothPath(compare, width, height, minDb, maxDb) : '';
  const area = path ? `${path} L${width},${height} L0,${height} Z` : '';
  return (
    <div ref={containerRef} className="relative w-full">
      <svg width={width} height={height} className="block">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={0} x2={width} y1={t * height} y2={t * height} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        ))}
        {[100, 1000, 10000].map((f) => (
          <line key={f} x1={bandX(f, width)} x2={bandX(f, width)} y1={0} y2={height} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
        ))}
        {area && <path d={area} fill={color} opacity={0.12} />}
        {comparePath && <path d={comparePath} fill="none" stroke={compareColor} strokeWidth={1.4} strokeDasharray="3 3" opacity={0.85} />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.8} />
        {[100, 1000, 10000].map((f) => (
          <text key={f} x={bandX(f, width) + 3} y={height - 4} fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
      </svg>
      <div className="absolute right-1 top-1 flex gap-3 text-2xs">
        {label && (
          <span className="flex items-center gap-1" style={{ color }}>
            <span className="inline-block h-0.5 w-3" style={{ background: color }} />
            {label}
          </span>
        )}
        {compareLabel && (
          <span className="flex items-center gap-1" style={{ color: compareColor }}>
            <span className="inline-block h-0.5 w-3 border-t border-dashed" style={{ borderColor: compareColor }} />
            {compareLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function BandBars({ bands, height = 90, color = '#c8f169' }: { bands: BandLevel[]; height?: number; color?: string }) {
  const values = bands.map((b) => b.relativeDb);
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {values.map((v, i) => (
        <div key={BAND_CENTERS[i]} className="flex h-full flex-1 flex-col justify-center" title={`${BAND_CENTERS[i]} Hz: ${v.toFixed(1)} dB`}>
          <div
            className="w-full rounded-sm"
            style={{
              height: `${(Math.abs(v) / max) * 45}%`,
              background: v >= 0 ? color : '#f2657a',
              opacity: 0.3 + (Math.abs(v) / max) * 0.7,
            }}
          />
          <div className="h-px w-full bg-ink-600" />
        </div>
      ))}
    </div>
  );
}

export function LoudnessChart({
  points,
  target,
  height = 110,
}: {
  points: LoudnessPoint[];
  target?: number;
  height?: number;
}) {
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (!points.length) return <div className="text-2xs text-ink-500">No loudness data.</div>;
  const min = Math.min(...points.map((p) => p.lufs), target ?? 0) - 2;
  const max = Math.max(...points.map((p) => p.lufs), target ?? 0) + 2;
  const span = Math.max(1, max - min);
  const maxTime = points[points.length - 1].time || 1;
  const path = points
    .map((p, i) => {
      const x = (p.time / maxTime) * width;
      const y = height - ((p.lufs - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={height} className="block">
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={0} x2={width} y1={t * height} y2={t * height} stroke="rgba(255,255,255,0.05)" />
        ))}
        <path d={path} fill="none" stroke="#5ad1e6" strokeWidth={1.4} />
        {target !== undefined && target > -70 && (
          <>
            <line
              x1={0}
              x2={width}
              y1={height - ((target - min) / span) * height}
              y2={height - ((target - min) / span) * height}
              stroke="#c8f169"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <text x={width - 4} y={height - ((target - min) / span) * height - 3} textAnchor="end" fill="#c8f169" fontSize={8} fontFamily="JetBrains Mono">
              target {target.toFixed(1)}
            </text>
          </>
        )}
        <text x={2} y={10} fill="rgba(255,255,255,0.35)" fontSize={8} fontFamily="JetBrains Mono">
          {max.toFixed(0)} LUFS
        </text>
        <text x={2} y={height - 3} fill="rgba(255,255,255,0.35)" fontSize={8} fontFamily="JetBrains Mono">
          {min.toFixed(0)}
        </text>
      </svg>
    </div>
  );
}

export function EQCurve({ params, height = 150, color = '#c8f169' }: { params: ParamValues; height?: number; color?: string }) {
  const [width, setWidth] = useState(500);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const freqs = new Float32Array(240);
  for (let i = 0; i < 240; i++) freqs[i] = 20 * Math.pow(1000, i / 239);
  const response = ParametricEq.response(params, 48000, freqs);
  const path = Array.from(response)
    .map((db, i) => {
      const x = (Math.log2(freqs[i] / 20) / Math.log2(1000)) * width;
      const y = height / 2 - (clamp(db, -18, 18) / 18) * (height / 2 - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded border border-ink-700 bg-ink-950">
      <svg width={width} height={height} className="block">
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line
              x1={0}
              x2={width}
              y1={height / 2 - (db / 18) * (height / 2 - 4)}
              y2={height / 2 - (db / 18) * (height / 2 - 4)}
              stroke={db === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'}
            />
            <text x={2} y={height / 2 - (db / 18) * (height / 2 - 4) - 2} fill="rgba(255,255,255,0.25)" fontSize={7} fontFamily="JetBrains Mono">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {[50, 100, 500, 1000, 5000, 10000].map((f) => (
          <line
            key={f}
            x1={(Math.log2(f / 20) / Math.log2(1000)) * width}
            x2={(Math.log2(f / 20) / Math.log2(1000)) * width}
            y1={0}
            y2={height}
            stroke="rgba(255,255,255,0.05)"
          />
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      </svg>
    </div>
  );
}

export function formatClock(seconds: number): string {
  return formatTime(seconds);
}

export function dbText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function linearToDb(linear: number): number {
  return gainToDb(linear);
}
