import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, IconButton, Panel, Select, useFilePicker } from '../ui/Primitives';
import { Mixer, TransportBar, AssistantPanel } from '../ui/Mixer';
import { Rack } from '../ui/Rack';
import { Waveform, useMeters } from '../ui/viz';
import { findTrack } from '../audio/model/project';
import { uid } from '../audio/model/defaults';
import type { ClipState, TrackKind } from '../audio/model/types';
import { formatTime } from '../audio/dsp/util';

type Focus = { scope: 'master' | 'track' | 'bus'; id: string | null };

export default function Studio() {
  const project = useApp((s) => s.project);
  const { assetBuffers, selectedTrackId, selectTrack, importFiles, updateTrack, removeTrack, addTrack } = useApp();
  const picker = useFilePicker();
  const [focus, setFocus] = useState<Focus>({ scope: 'master', id: null });
  const [rightTab, setRightTab] = useState<'rack' | 'assistant'>('rack');
  const meters = useMeters();
  const position = useApp((s) => s.transport.position);
  const selectedProcessorId = useApp((s) => s.selectedProcessorId);
  const selected = project ? findTrack(project, selectedTrackId) : undefined;
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('vocal');

  const effectiveFocus: Focus = useMemo(() => {
    if (focus.scope === 'track' && !(project ? findTrack(project, focus.id) : undefined)) return { scope: 'master', id: null };
    if (focus.scope === 'bus' && !project?.buses.some((b) => b.id === focus.id)) return { scope: 'master', id: null };
    return focus;
  }, [focus, project]);

  if (!project) {
    return (
      <div className="p-5">
        <Panel>
          <EmptyState
            title="No project open"
            description="Create a project to access the mixing studio."
            action={<Button variant="primary" onClick={() => useApp.getState().setScreen('projects')}>Go to projects</Button>}
          />
        </Panel>
      </div>
    );
  }

  const focusTrack = effectiveFocus.scope === 'track' ? findTrack(project, effectiveFocus.id) : null;
  const processors =
    effectiveFocus.scope === 'master'
      ? project.master.processors
      : effectiveFocus.scope === 'track'
        ? focusTrack?.processors ?? []
        : project.buses.find((b) => b.id === effectiveFocus.id)?.processors ?? [];
  const focusLabel =
    effectiveFocus.scope === 'master'
      ? 'Master'
      : effectiveFocus.scope === 'bus'
        ? project.buses.find((b) => b.id === effectiveFocus.id)?.name ?? 'Bus'
        : focusTrack?.name ?? 'Track';

  const duration = Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  const selectedPeaks = selected?.clips[0] ? assetBuffers[selected.clips[0].assetId]?.peaks ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm text-ink-100">{project.name}</h1>
          <Badge>{project.sampleRate / 1000} kHz</Badge>
          <Badge>{project.tracks.filter((t) => t.clips.length).length} tracks</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'))}>
            Import audio
          </Button>
          <Button size="sm" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'stem'))}>
            Import stems
          </Button>
          <Button size="sm" variant="ghost" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'reference'))}>
            Add reference
          </Button>
        </div>
      </div>

      <TransportBar />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900/50 md:flex">
          <div className="flex items-center justify-between border-b border-ink-700 px-2 py-1.5">
            <span className="section-label">Tracks</span>
            <button type="button" className="text-2xs text-ink-400 hover:text-accent" onClick={() => addTrack(newTrackKind)}>
              + add
            </button>
          </div>
          <div className="flex gap-1 border-b border-ink-700 px-2 py-1">
            <select
              value={newTrackKind}
              onChange={(e) => setNewTrackKind(e.target.value as TrackKind)}
              className="w-full rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-2xs text-ink-300"
            >
              {['audio', 'vocal', 'instrument', 'drums', 'bass', 'instrumental', 'stem'].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {project.tracks.map((track) => (
              <div
                key={track.id}
                className={`group mb-0.5 rounded border px-1.5 py-1 ${
                  selectedTrackId === track.id ? 'border-ink-600 bg-ink-800' : 'border-transparent hover:bg-ink-850'
                }`}
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => {
                    selectTrack(track.id);
                    setFocus({ scope: 'track', id: track.id });
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: track.color }} />
                    <span className="min-w-0 flex-1 truncate text-2xs text-ink-100">{track.name}</span>
                    {track.kind === 'reference' && <span className="text-2xs text-signal-cyan">REF</span>}
                  </div>
                  <div className="pl-3 font-mono text-2xs text-ink-500">
                    {track.clips.length} clip{track.clips.length === 1 ? '' : 's'} · {track.processors.length} fx
                  </div>
                </button>
                <div className="mt-1 flex items-center gap-1 opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => updateTrack(track.id, { muted: !track.muted })}
                    className={`rounded px-1 text-2xs ${track.muted ? 'bg-signal-red/20 text-signal-red' : 'text-ink-500'}`}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTrack(track.id, { soloed: !track.soloed })}
                    className={`rounded px-1 text-2xs ${track.soloed ? 'bg-signal-amber/20 text-signal-amber' : 'text-ink-500'}`}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete track "${track.name}"?`)) removeTrack(track.id);
                    }}
                    className="ml-auto text-2xs text-ink-600 hover:text-signal-red"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
            {project.tracks.length === 0 && (
              <div className="p-2 text-2xs leading-relaxed text-ink-500">
                No tracks yet. Import a song or stems to populate the session.
              </div>
            )}
          </div>
          <div className="border-t border-ink-700 p-2">
            <Button size="sm" variant="ghost" onClick={() => useApp.getState().addBus(`Bus ${project.buses.length + 1}`)}>
              + Add bus
            </Button>
            {project.buses.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {project.buses.map((bus) => (
                  <button
                    key={bus.id}
                    type="button"
                    onClick={() => setFocus({ scope: 'bus', id: bus.id })}
                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-2xs ${
                      effectiveFocus.scope === 'bus' && effectiveFocus.id === bus.id
                        ? 'bg-ink-800 text-signal-cyan'
                        : 'text-ink-500 hover:text-ink-200'
                    }`}
                  >
                    {bus.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-ink-700 p-3">
            {selected ? (
              <>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-100">{selected.name}</span>
                    <Badge>{selected.kind}</Badge>
                    <span className="font-mono text-2xs text-ink-500">{formatTime(duration)} session</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const clip = selected.clips[0];
                        const report = clip ? useApp.getState().analyses[clip.assetId] : null;
                        if (report && clip) {
                          useApp.getState().selectAsset(clip.assetId);
                          useApp.getState().setScreen('analysis');
                        } else if (clip) {
                          useApp.getState().selectAsset(clip.assetId);
                          void useApp.getState().analyzeAsset(clip.assetId);
                        } else {
                          useApp.getState().setToast('This track has no audio clip yet.');
                        }
                      }}
                    >
                      Analyse
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const clip = selected.clips[0];
                        if (!clip) return;
                        const buffer = assetBuffers[clip.assetId];
                        if (!buffer) return;
                        let peak = 0;
                        for (let i = 0; i < buffer.L.length; i++) {
                          peak = Math.max(peak, Math.abs(buffer.L[i]), Math.abs(buffer.R[i]));
                        }
                        if (peak < 1e-9) return;
                        useApp.getState().mutate((p) => {
                          const track = p.tracks.find((t) => t.id === selected.id);
                          const target = track?.clips.find((c) => c.id === clip.id);
                          if (target) target.gainDb = -20 * Math.log10(peak);
                        });
                        useApp.setState({ toast: 'Clip gain normalised to 0 dBFS peak.' });
                      }}
                    >
                      Normalise clip
                    </Button>
                  </div>
                </div>
                <Waveform
                  peaks={selectedPeaks}
                  duration={Math.max(selected.clips[0]?.duration ?? 0, 0.01)}
                  position={position}
                  onSeek={(seconds) => useApp.getState().seek(seconds)}
                  height={110}
                  color={selected.color}
                />
                <div className="mt-2 grid gap-1">
                  {selected.clips.map((clip) => (
                    <ClipRow key={clip.id} trackId={selected.id} clip={clip} />
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="text-xs text-ink-300">Select a track to see its timeline.</p>
                <p className="mt-1 text-2xs text-ink-500">Import a song or stems to start.</p>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-700 bg-ink-900/90 px-3 py-1.5 backdrop-blur">
              <span className="section-label">Mixer</span>
              <span className="text-2xs text-ink-500">Meters read the actual engine output</span>
            </div>
            <Mixer focus={effectiveFocus} onFocus={(scope, id) => setFocus({ scope, id })} />
          </div>
        </main>

        <aside className="hidden w-[380px] shrink-0 flex-col border-l border-ink-700 bg-ink-900/40 xl:flex">
          <div className="flex border-b border-ink-700">
            <button
              type="button"
              onClick={() => setRightTab('rack')}
              className={`flex-1 px-3 py-2 text-2xs uppercase tracking-wider ${rightTab === 'rack' ? 'border-b border-accent text-accent' : 'text-ink-500'}`}
            >
              {focusLabel} chain
            </button>
            <button
              type="button"
              onClick={() => setRightTab('assistant')}
              className={`flex-1 px-3 py-2 text-2xs uppercase tracking-wider ${rightTab === 'assistant' ? 'border-b border-accent text-accent' : 'text-ink-500'}`}
            >
              Assistant
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {rightTab === 'rack' ? (
              <Rack
                scope={effectiveFocus.scope}
                trackId={effectiveFocus.id}
                processors={processors}
                selectedId={selectedProcessorId}
                onSelect={(id) => useApp.getState().selectProcessor(id)}
                meters={meters.gr[effectiveFocus.scope === 'master' ? 'master' : effectiveFocus.id ?? ''] ?? {}}
                emptyHint={
                  effectiveFocus.scope === 'master'
                    ? 'Generate a reference match chain or add mastering processors here.'
                    : 'Add processors for this track, or load a preset.'
                }
              />
            ) : (
              <AssistantPanel />
            )}
          </div>
        </aside>
      </div>
      <div className="xl:hidden">
        <Panel className="m-2">
          <AssistantPanel />
        </Panel>
      </div>
    </div>
  );
}

function ClipRow({ trackId, clip }: { trackId: string; clip: ClipState }) {
  const project = useApp((s) => s.project)!;
  const buffer = useApp((s) => s.assetBuffers[clip.assetId]);
  const asset = useApp((s) => s.assets).find((a) => a.id === clip.assetId);
  const update = (patch: Partial<ClipState>) => {
    useApp.getState().mutate((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      const target = track?.clips.find((c) => c.id === clip.id);
      if (target) Object.assign(target, patch);
    });
  };
  const split = () => {
    const time = useApp.getState().transport.position;
    if (time <= clip.start + 0.05 || time >= clip.start + clip.duration - 0.05) return;
    useApp.getState().mutate((p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const index = track.clips.findIndex((c) => c.id === clip.id);
      if (index < 0) return;
      const left = { ...clip, duration: time - clip.start, fadeOut: 0 };
      const right = {
        ...clip,
        id: uid('clip'),
        start: time,
        offset: clip.offset + (time - clip.start),
        duration: clip.duration - (time - clip.start),
        fadeIn: 0,
      };
      track.clips.splice(index, 1, left, right);
    });
    useApp.setState({ toast: 'Clip split at playhead.' });
    void project;
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-ink-700 bg-ink-850/60 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-2xs text-ink-200">{asset?.name ?? 'Missing asset'}</span>
      <label className="flex items-center gap-1 text-2xs text-ink-500">
        start
        <input
          type="number"
          className="w-14 rounded border border-ink-700 bg-ink-900 px-1 font-mono text-2xs text-ink-200"
          value={clip.start.toFixed(2)}
          step={0.1}
          onChange={(e) => update({ start: Math.max(0, Number(e.target.value)) })}
        />
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-500">
        len
        <input
          type="number"
          className="w-14 rounded border border-ink-700 bg-ink-900 px-1 font-mono text-2xs text-ink-200"
          value={clip.duration.toFixed(2)}
          step={0.1}
          onChange={(e) => update({ duration: Math.max(0.05, Number(e.target.value)) })}
        />
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-500">
        fade in
        <input
          type="number"
          className="w-12 rounded border border-ink-700 bg-ink-900 px-1 font-mono text-2xs text-ink-200"
          value={clip.fadeIn.toFixed(2)}
          step={0.05}
          onChange={(e) => update({ fadeIn: Math.max(0, Math.min(clip.duration, Number(e.target.value))) })}
        />
      </label>
      <label className="flex items-center gap-1 text-2xs text-ink-500">
        fade out
        <input
          type="number"
          className="w-12 rounded border border-ink-700 bg-ink-900 px-1 font-mono text-2xs text-ink-200"
          value={clip.fadeOut.toFixed(2)}
          step={0.05}
          onChange={(e) => update({ fadeOut: Math.max(0, Math.min(clip.duration, Number(e.target.value))) })}
        />
      </label>
      <IconButton title="Split at playhead" onClick={split}>
        split
      </IconButton>
      <IconButton
        title="Delete clip"
        onClick={() =>
          useApp.getState().mutate((p) => {
            const track = p.tracks.find((t) => t.id === trackId);
            if (track) track.clips = track.clips.filter((c) => c.id !== clip.id);
          })
        }
        className="!text-signal-red"
      >
        del
      </IconButton>
      {!buffer && <span className="text-2xs text-signal-amber">audio not loaded</span>}
      {void project}
    </div>
  );
}

void Select;
