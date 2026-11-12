import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/store';
import { realtimeHost } from '../audio/engine/realtime';
import { formatTime } from '../audio/dsp/util';
import { Icon } from './Icon';

export function StudioTimeline() {
  const project = useApp((state) => state.project);
  const assets = useApp((state) => state.assets);
  const buffers = useApp((state) => state.assetBuffers);
  const position = useApp((state) => state.transport.position);
  const playing = useApp((state) => state.transport.playing);
  const loopEnabled = useApp((state) => state.transport.loopEnabled);
  const loopStart = useApp((state) => state.transport.loopStart);
  const loopEnd = useApp((state) => state.transport.loopEnd);
  const transportDuration = useApp((state) => state.transport.duration);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const draggingPointer = useRef<number | null>(null);

  const preferredAssetId = project?.targetAssetIds[0]
    ?? project?.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId))[0];
  const audioAsset = assets.find((asset) => asset.id === preferredAssetId) ?? assets[0];
  const peaks = audioAsset ? buffers[audioAsset.id]?.peaks ?? null : null;
  const clipEnd = Math.max(0, ...(project?.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)) ?? []));
  const duration = Math.max(transportDuration, audioAsset?.duration ?? 0, clipEnd);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const draw = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      context.strokeStyle = 'rgba(255,255,255,0.055)';
      context.lineWidth = 1;
      for (let index = 1; index < 4; index += 1) {
        const y = (height / 4) * index;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      if (loopEnabled && duration > 0) {
        const left = Math.max(0, Math.min(1, loopStart / duration)) * width;
        const right = Math.max(0, Math.min(1, loopEnd / duration)) * width;
        context.fillStyle = 'rgba(137,87,255,0.10)';
        context.fillRect(left, 0, Math.max(1, right - left), height);
      }

      if (peaks?.length) {
        const samplesPerPixel = peaks.length / width;
        context.fillStyle = '#A77AFF';
        for (let x = 0; x < width; x += 1) {
          const from = Math.floor(x * samplesPerPixel);
          const to = Math.max(from + 1, Math.floor((x + 1) * samplesPerPixel));
          let peak = 0;
          for (let index = from; index < to && index < peaks.length; index += 1) {
            peak = Math.max(peak, peaks[index]);
          }
          const amplitude = Math.max(1, peak * height * 0.43);
          context.fillRect(x, (height - amplitude * 2) / 2, 1, amplitude * 2);
        }
      } else {
        context.fillStyle = 'rgba(167,122,255,0.22)';
        context.fillRect(0, Math.floor(height / 2), width, 1);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [peaks, duration, loopEnabled, loopStart, loopEnd]);

  const paintPlayhead = (seconds: number) => {
    const node = playheadRef.current;
    if (!node) return;
    const progress = duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0;
    node.style.transform = `translate3d(calc(-100% + ${progress * 100}%), 0, 0)`;
  };

  useEffect(() => {
    if (!playing) {
      paintPlayhead(position);
      return;
    }
    let frame = 0;
    const animate = () => {
      paintPlayhead(realtimeHost.position);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, duration]);

  useEffect(() => {
    if (!playing) paintPlayhead(position);
  }, [position, playing, duration]);

  const seekAt = (clientX: number) => {
    const element = waveformRef.current;
    if (!element || duration <= 0) return;
    const bounds = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    useApp.getState().seek(ratio * duration);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || duration <= 0) return;
    event.preventDefault();
    draggingPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekAt(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    seekAt(event.clientX);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    draggingPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = position - 1;
    else if (event.key === 'ArrowRight') next = position + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    if (next !== null) {
      event.preventDefault();
      useApp.getState().seek(Math.max(0, Math.min(duration, next)));
    }
  };

  const toggleLoop = () => {
    useApp.getState().setLoop(!loopEnabled, 0, duration);
  };

  if (!project) return null;

  return (
    <section aria-label="Session timeline" className="studio-session-timeline flex h-[104px] shrink-0 items-center gap-4 border-b border-white/[.07] bg-[#0B0B18] px-4 sm:px-6">
      <div className="hidden w-[172px] min-w-0 shrink-0 flex-col justify-center gap-1 md:flex">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="waveform" size={16} className="shrink-0 text-[#C4A2FF]" />
          <span className="truncate text-xs font-semibold text-ink-100">{audioAsset?.name ?? project.name}</span>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-400">
          {formatTime(position)} <span className="text-ink-600">/</span> {formatTime(duration)}
        </div>
        <div className="text-[9px] uppercase tracking-[.14em] text-ink-600">Session timeline</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-between px-0.5 font-mono text-[9px] tabular-nums text-ink-600">
          <span>00:00</span>
          <span>{formatTime(duration * 0.25)}</span>
          <span>{formatTime(duration * 0.5)}</span>
          <span>{formatTime(duration * 0.75)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div
          ref={waveformRef}
          role="slider"
          tabIndex={0}
          aria-label="Audio timeline playhead"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.min(position, duration)}
          aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { draggingPointer.current = null; }}
          onKeyDown={onKeyDown}
          className="focus-ring relative h-[54px] cursor-crosshair touch-none overflow-hidden rounded-xl border border-white/[.08] bg-[#11111F]"
        >
          <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
          <div ref={playheadRef} aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-full">
            <div className="absolute inset-y-0 right-0 w-[2px] bg-[#E6D9FF] shadow-[0_0_10px_rgba(167,122,255,.8)]" />
            <span className="absolute right-0 top-0 -translate-x-1/2 rounded-b bg-[#A77AFF] px-1.5 py-0.5 font-mono text-[8px] font-semibold text-[#090914]">PLAY</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden text-right sm:block md:hidden">
          <div className="font-mono text-[10px] tabular-nums text-ink-300">{formatTime(position)}</div>
          <div className="font-mono text-[9px] text-ink-600">/ {formatTime(duration)}</div>
        </div>
        <button
          type="button"
          onClick={toggleLoop}
          disabled={duration <= 0}
          aria-pressed={loopEnabled}
          title={loopEnabled ? 'Disable loop' : 'Loop full session'}
          className={`focus-ring flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-semibold transition-colors disabled:opacity-40 ${loopEnabled ? 'border-[#A77AFF]/45 bg-[#8957FF]/15 text-[#C4A2FF]' : 'border-white/[.08] bg-white/[.025] text-ink-400 hover:border-white/[.16] hover:text-ink-100'}`}
        >
          <Icon name="repeat" size={14} /> <span className="hidden sm:inline">Loop</span>
        </button>
      </div>
    </section>
  );
}
