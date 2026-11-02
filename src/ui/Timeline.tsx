import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/store';
import { uid } from '../audio/model/defaults';
import type { ClipState, ProjectState } from '../audio/model/types';
import { moveClipTo, snapTimelineTime, trimClipEnd, trimClipStart } from '../audio/model/timeline';
import { Button, IconButton } from './Primitives';

type EditMode = 'move' | 'trim-start' | 'trim-end';
interface ClipGesture {
  clipId: string;
  trackId: string;
  mode: EditMode;
  pointerId: number;
  startX: number;
  initialStart: number;
  initialDuration: number;
  initialOffset: number;
  nextStart: number;
  nextDuration: number;
  nextOffset: number;
}

const TRACK_HEADER_WIDTH = 166;
const MIN_CLIP_SECONDS = 0.05;

function sessionDuration(project: ProjectState, fallback: number): number {
  return Math.max(
    16,
    fallback,
    ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
  );
}

export function Timeline() {
  const project = useApp((state) => state.project);
  const assets = useApp((state) => state.assets);
  const buffers = useApp((state) => state.assetBuffers);
  const selectedTrackId = useApp((state) => state.selectedTrackId);
  const position = useApp((state) => state.transport.position);
  const transportDuration = useApp((state) => state.transport.duration);
  const tempo = useApp((state) => state.project?.tempo ?? 120);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(76);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [grid, setGrid] = useState<'bar' | 'beat' | 'half' | 'quarter'>('beat');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [gesture, setGesture] = useState<ClipGesture | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const duration = project ? sessionDuration(project, transportDuration) : 16;
  const contentWidth = Math.max(960, duration * pixelsPerSecond);
  const beatSeconds = 60 / Math.max(20, tempo);
  const gridSeconds = beatSeconds * (
    grid === 'bar' ? 4 : grid === 'half' ? 0.5 : grid === 'quarter' ? 0.25 : 1
  );
  const barSeconds = beatSeconds * 4;
  const bars = Math.ceil(duration / barSeconds);
  const selectedTrack = project?.tracks.find((track) => track.id === selectedTrackId);
  const selectedClip = project?.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .find((item) => item.clip.id === selectedClipId);
  const referenceNames = useMemo(() => new Map(assets.map((asset) => [asset.id, asset.name])), [assets]);

  if (!project) return null;

  const snapTime = (seconds: number) => snapTimelineTime(seconds, gridSeconds, snapEnabled);

  const refreshTransportDuration = () => {
    const state = useApp.getState();
    const nextDuration = Math.max(
      0,
      ...((state.project?.tracks ?? []).flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))),
    );
    useApp.setState((current) => ({
      transport: {
        ...current.transport,
        duration: nextDuration,
        loopEnd: current.transport.loopEnabled ? Math.min(current.transport.loopEnd, nextDuration) : current.transport.loopEnd,
      },
    }));
  };

  const updateSelectedClip = (patch: Partial<Pick<ClipState, 'gainDb' | 'fadeIn' | 'fadeOut'>>) => {
    if (!selectedClip) return;
    const trackId = selectedClip.track.id;
    const clipId = selectedClip.clip.id;
    useApp.getState().mutate((state) => {
      const track = state.tracks.find((item) => item.id === trackId);
      const clip = track?.clips.find((item) => item.id === clipId);
      if (!clip) return;
      Object.assign(clip, patch);
      clip.fadeIn = Math.max(0, Math.min(clip.duration, clip.fadeIn));
      clip.fadeOut = Math.max(0, Math.min(clip.duration, clip.fadeOut));
    }, { coalesce: 'timeline-clip:' + clipId });
  };

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>, trackId: string, clip: ClipState, mode: EditMode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setSelectedClipId(clip.id);
    useApp.getState().selectTrack(trackId);
    setGesture({
      clipId: clip.id,
      trackId,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      initialStart: clip.start,
      initialDuration: clip.duration,
      initialOffset: clip.offset,
      nextStart: clip.start,
      nextDuration: clip.duration,
      nextOffset: clip.offset,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = (event.clientX - gesture.startX) / pixelsPerSecond;
    let nextStart = gesture.initialStart;
    let nextDuration = gesture.initialDuration;
    let nextOffset = gesture.initialOffset;

    const clipTiming = {
      start: gesture.initialStart,
      duration: gesture.initialDuration,
      offset: gesture.initialOffset,
    };
    if (gesture.mode === 'move') {
      nextStart = moveClipTo(clipTiming, gesture.initialStart + delta, gridSeconds, snapEnabled).start;
    } else if (gesture.mode === 'trim-end') {
      const sourceClip = project.tracks
        .find((track) => track.id === gesture.trackId)
        ?.clips.find((clip) => clip.id === gesture.clipId);
      const sourceDuration = sourceClip
        ? assets.find((asset) => asset.id === sourceClip.assetId)?.duration ?? Infinity
        : Infinity;
      const trimmed = trimClipEnd(
        clipTiming,
        gesture.initialStart + gesture.initialDuration + delta,
        sourceDuration,
        gridSeconds,
        snapEnabled,
      );
      nextDuration = trimmed.duration;
    } else {
      const trimmed = trimClipStart(
        clipTiming,
        gesture.initialStart + delta,
        gridSeconds,
        snapEnabled,
      );
      nextStart = trimmed.start;
      nextDuration = trimmed.duration;
      nextOffset = trimmed.offset;
    }
    setGesture({ ...gesture, nextStart, nextDuration, nextOffset });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const finalGesture = gesture;
    if (
      Math.abs(finalGesture.nextStart - finalGesture.initialStart) > 0.0001 ||
      Math.abs(finalGesture.nextDuration - finalGesture.initialDuration) > 0.0001 ||
      Math.abs(finalGesture.nextOffset - finalGesture.initialOffset) > 0.0001
    ) {
      useApp.getState().mutate((state) => {
        const track = state.tracks.find((item) => item.id === finalGesture.trackId);
        const clip = track?.clips.find((item) => item.id === finalGesture.clipId);
        if (!clip) return;
        clip.start = finalGesture.nextStart;
        clip.duration = finalGesture.nextDuration;
        clip.offset = finalGesture.nextOffset;
      });
      refreshTransportDuration();
    }
    setGesture(null);
  };

  const seekFromRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const seconds = snapTime((event.clientX - rect.left) / pixelsPerSecond);
    useApp.getState().seek(Math.min(duration, seconds));
  };

  const splitSelected = () => {
    if (!selectedClip) return;
    const splitTime = position;
    const { track, clip } = selectedClip;
    if (splitTime <= clip.start + MIN_CLIP_SECONDS || splitTime >= clip.start + clip.duration - MIN_CLIP_SECONDS) {
      useApp.getState().setToast('Move the playhead inside the selected clip before splitting.');
      return;
    }
    useApp.getState().mutate((state) => {
      const targetTrack = state.tracks.find((item) => item.id === track.id);
      if (!targetTrack) return;
      const index = targetTrack.clips.findIndex((item) => item.id === clip.id);
      if (index < 0) return;
      const leftDuration = splitTime - clip.start;
      const right = {
        ...clip,
        id: uid('clip'),
        start: splitTime,
        offset: clip.offset + leftDuration,
        duration: clip.duration - leftDuration,
        fadeIn: 0,
      };
      targetTrack.clips.splice(index, 1, { ...clip, duration: leftDuration, fadeOut: 0 }, right);
      setSelectedClipId(right.id);
    });
    refreshTransportDuration();
    useApp.getState().setToast('Clip split at the playhead.');
  };

  const deleteSelected = () => {
    if (!selectedClip) return;
    const clipId = selectedClip.clip.id;
    const trackId = selectedClip.track.id;
    useApp.getState().mutate((state) => {
      const track = state.tracks.find((item) => item.id === trackId);
      if (track) track.clips = track.clips.filter((clip) => clip.id !== clipId);
    });
    setSelectedClipId(null);
    refreshTransportDuration();
    useApp.getState().setToast('Clip deleted.');
  };

  const duplicateSelected = () => {
    if (!selectedClip) return;
    const copy: ClipState = {
      ...selectedClip.clip,
      id: uid('clip'),
      start: snapTime(selectedClip.clip.start + selectedClip.clip.duration),
    };
    useApp.getState().mutate((state) => {
      const track = state.tracks.find((item) => item.id === selectedClip.track.id);
      if (track) track.clips.push(copy);
    });
    setSelectedClipId(copy.id);
    refreshTransportDuration();
    useApp.getState().setToast('Clip duplicated after the original.');
  };

  return (
    <section className="flex min-h-[330px] min-w-0 flex-1 flex-col bg-ink-950">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="section-label text-ink-300">Arrangement timeline</span>
          <label className="flex items-center gap-1 font-mono text-2xs text-ink-500">
            Tempo
            <input
              aria-label="Project tempo in beats per minute"
              type="number"
              min="30"
              max="300"
              step="0.1"
              value={project.tempo}
              onChange={(event) => {
                const nextTempo = Math.max(30, Math.min(300, Number(event.target.value) || 120));
                useApp.getState().mutate((state) => { state.tempo = nextTempo; });
              }}
              className="w-14 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-right text-2xs text-ink-100"
            />
            BPM
          </label>
          <span className="font-mono text-2xs text-ink-600">{project.tracks.length} tracks</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-2xs text-ink-500">
            Grid
            <select
              value={grid}
              onChange={(event) => setGrid(event.target.value as typeof grid)}
              className="rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-2xs text-ink-200"
            >
              <option value="bar">Bar</option>
              <option value="beat">Beat</option>
              <option value="half">1/2 beat</option>
              <option value="quarter">1/4 beat</option>
            </select>
          </label>
          <IconButton active={snapEnabled} title="Toggle snap to grid" onClick={() => setSnapEnabled((value) => !value)}>
            Snap {snapEnabled ? 'on' : 'off'}
          </IconButton>
          <label className="flex items-center gap-1 text-2xs text-ink-500">
            Zoom
            <input
              aria-label="Timeline zoom"
              type="range"
              min="24"
              max="180"
              value={pixelsPerSecond}
              onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
              className="w-20"
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const availableWidth = Math.max(320, (contentRef.current?.clientWidth ?? 640) - TRACK_HEADER_WIDTH);
              setPixelsPerSecond(Math.max(24, Math.min(180, availableWidth / Math.max(1, duration))));
            }}
          >
            Fit
          </Button>
          <Button size="sm" onClick={() => useApp.getState().addTrack('audio', 'Audio ' + (project.tracks.length + 1))}>+ Track</Button>
          <Button size="sm" variant="ghost" disabled={!selectedClip} onClick={duplicateSelected}>Duplicate</Button>
          <Button size="sm" variant="ghost" disabled={!selectedClip} onClick={splitSelected}>Split</Button>
          <Button size="sm" variant="danger" disabled={!selectedClip} onClick={deleteSelected}>Delete</Button>
        </div>
      </div>

      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setGesture(null)}
      >
        <div style={{ width: TRACK_HEADER_WIDTH + contentWidth, minWidth: '100%' }}>
          <div
            className="sticky top-0 z-20 grid h-9 border-b border-ink-700 bg-ink-900/95"
            style={{ gridTemplateColumns: TRACK_HEADER_WIDTH + 'px ' + contentWidth + 'px' }}
          >
            <div className="sticky left-0 z-30 flex items-center border-r border-ink-700 bg-ink-900 px-2">
              <span className="section-label">Track / clip</span>
            </div>
            <div
              className="relative cursor-crosshair"
              onPointerDown={seekFromRuler}
              style={{
                backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px)',
                backgroundSize: (barSeconds * pixelsPerSecond) + 'px 100%',
              }}
            >
              {Array.from({ length: bars + 1 }, (_, index) => (
                <div key={index} className="absolute inset-y-0 border-l border-ink-600/70" style={{ left: index * barSeconds * pixelsPerSecond }}>
                  <span className="pl-1.5 pt-1 font-mono text-2xs text-ink-500">{index + 1}</span>
                </div>
              ))}
              <div className="absolute bottom-0 left-0 h-px w-full bg-ink-700" />
            </div>
          </div>

          {project.tracks.map((track) => (
            <div
              key={track.id}
              className="grid min-h-[72px] border-b border-ink-800"
              style={{ gridTemplateColumns: TRACK_HEADER_WIDTH + 'px ' + contentWidth + 'px' }}
            >
              <div
                className={
                  'sticky left-0 z-10 flex min-w-0 flex-col justify-center border-r border-ink-700 px-2 py-1 ' +
                  (selectedTrackId === track.id ? 'bg-ink-800' : 'bg-ink-900/95')
                }
              >
                <button type="button" onClick={() => useApp.getState().selectTrack(track.id)} className="flex min-w-0 items-center gap-1.5 text-left">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: track.color }} />
                  <span className="truncate text-2xs text-ink-100">{track.name}</span>
                </button>
                <div className="mt-1 flex items-center gap-1">
                  <IconButton title="Mute track" active={track.muted} onClick={() => useApp.getState().updateTrack(track.id, { muted: !track.muted })}>M</IconButton>
                  <IconButton title="Solo track" active={track.soloed} onClick={() => useApp.getState().updateTrack(track.id, { soloed: !track.soloed })}>S</IconButton>
                  <span className="truncate text-2xs text-ink-600">{track.clips.length} clips</span>
                </div>
              </div>

              <div
                className="relative min-h-[72px] bg-ink-950/60"
                style={{
                  backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.055) 1px, transparent 1px)',
                  backgroundSize: (barSeconds * pixelsPerSecond) + 'px 100%',
                }}
              >
                {track.clips.map((clip) => {
                  const buffer = buffers[clip.assetId];
                  const peaks = buffer?.peaks;
                  const isSelected = selectedClipId === clip.id;
                  const isDragging = gesture?.clipId === clip.id;
                  const start = isDragging ? gesture.nextStart : clip.start;
                  const clipDuration = isDragging ? gesture.nextDuration : clip.duration;
                  const offset = isDragging ? gesture.nextOffset : clip.offset;
                  const barsToDraw = peaks
                    ? Array.from({ length: Math.min(150, Math.max(24, Math.floor(clipDuration * 5))) }, (_, index) => {
                        const sourceFraction = (offset + (index / Math.max(1, Math.min(150, Math.max(24, Math.floor(clipDuration * 5)))) * clipDuration)) / Math.max(0.01, buffer?.L.length ? buffer.L.length / buffer.sampleRate : clipDuration);
                        const peakIndex = Math.max(0, Math.min(peaks.length - 1, Math.floor(sourceFraction * peaks.length)));
                        return peaks[peakIndex] ?? 0;
                      })
                    : [];
                  return (
                    <div
                      key={clip.id}
                      onPointerDown={(event) => startGesture(event, track.id, clip, 'move')}
                      onClick={() => {
                        setSelectedClipId(clip.id);
                        useApp.getState().selectTrack(track.id);
                      }}
                      className={
                        'group absolute top-2 h-[56px] select-none overflow-hidden rounded border ' +
                        (isSelected ? 'border-white/90 ring-1 ring-white/30' : 'border-white/15') +
                        ' cursor-grab active:cursor-grabbing'
                      }
                      style={{
                        left: start * pixelsPerSecond,
                        width: Math.max(28, clipDuration * pixelsPerSecond),
                        backgroundColor: track.color + '24',
                        touchAction: 'none',
                      }}
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-2 py-1">
                        <span className="truncate text-2xs font-medium text-ink-100">{referenceNames.get(clip.assetId) ?? 'Audio clip'}</span>
                        <span className="shrink-0 font-mono text-2xs text-ink-400">{clipDuration.toFixed(2)}s</span>
                      </div>
                      <div className="pointer-events-none absolute inset-x-1 bottom-1 top-5 flex items-center gap-px overflow-hidden opacity-85">
                        {barsToDraw.map((peak, index) => (
                          <span
                            key={index}
                            className="min-w-0 flex-1 rounded-sm"
                            style={{ height: Math.max(2, peak * 34), backgroundColor: track.color, opacity: 0.85 }}
                          />
                        ))}
                      </div>
                      <div
                        title="Trim clip start"
                        onPointerDown={(event) => startGesture(event, track.id, clip, 'trim-start')}
                        className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/30 opacity-40 transition-opacity hover:opacity-100 group-hover:opacity-100"
                      />
                      <div
                        title="Trim clip end"
                        onPointerDown={(event) => startGesture(event, track.id, clip, 'trim-end')}
                        className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/30 opacity-40 transition-opacity hover:opacity-100 group-hover:opacity-100"
                      />
                      {isDragging && <div className="pointer-events-none absolute inset-0 border border-white/70 bg-white/5" />}
                    </div>
                  );
                })}
                <div
                  className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-signal-amber/80"
                  style={{ left: position * pixelsPerSecond }}
                >
                  <span className="absolute top-0 -translate-x-1/2 rounded-sm bg-signal-amber px-1 font-mono text-[8px] text-ink-950">PLAY</span>
                </div>

              </div>
            </div>
          ))}

          {project.tracks.length === 0 && (
            <div className="flex h-28 items-center justify-center border-b border-ink-800 text-xs text-ink-500">
              Add a track or import audio to begin arranging your session.
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ink-700 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-mono text-2xs text-ink-500">
            {selectedClip
              ? selectedClip.track.name + ' · ' + selectedClip.clip.start.toFixed(2) + 's · ' + selectedClip.clip.duration.toFixed(2) + 's'
              : selectedTrack ? selectedTrack.name + ' selected' : 'Select a clip to edit'}
          </div>
          {selectedClip && (
            <>
              <label className="flex items-center gap-1 text-2xs text-ink-500">
                Gain
                <input
                  type="number"
                  min="-60"
                  max="24"
                  step="0.5"
                  value={selectedClip.clip.gainDb}
                  onChange={(event) => updateSelectedClip({ gainDb: Math.max(-60, Math.min(24, Number(event.target.value) || 0)) })}
                  className="w-14 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-right font-mono text-2xs text-ink-100"
                />
                dB
              </label>
              <label className="flex items-center gap-1 text-2xs text-ink-500">
                Fade in
                <input
                  type="number"
                  min="0"
                  max={selectedClip.clip.duration}
                  step="0.05"
                  value={selectedClip.clip.fadeIn}
                  onChange={(event) => updateSelectedClip({ fadeIn: Math.max(0, Math.min(selectedClip.clip.duration, Number(event.target.value) || 0)) })}
                  className="w-14 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-right font-mono text-2xs text-ink-100"
                />
                s
              </label>
              <label className="flex items-center gap-1 text-2xs text-ink-500">
                Fade out
                <input
                  type="number"
                  min="0"
                  max={selectedClip.clip.duration}
                  step="0.05"
                  value={selectedClip.clip.fadeOut}
                  onChange={(event) => updateSelectedClip({ fadeOut: Math.max(0, Math.min(selectedClip.clip.duration, Number(event.target.value) || 0)) })}
                  className="w-14 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-right font-mono text-2xs text-ink-100"
                />
                s
              </label>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {gesture && <span className="font-mono text-2xs text-accent">Editing clip…</span>}
          <span className="font-mono text-2xs text-ink-600">Drag to move · edges to trim · ruler to seek</span>
        </div>
      </div>
    </section>
  );
}
