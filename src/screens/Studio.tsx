import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, IconButton, Modal, Panel, ParamSlider, Toggle, useFilePicker } from '../ui/Primitives';
import { FlyoutMenu } from '../ui/FlyoutMenu';
import { Icon } from '../ui/Icon';
import { Mixer, TransportBar, AssistantPanel } from '../ui/Mixer';
import { Rack } from '../ui/Rack';
import { LevelMeter, useMeters } from '../ui/viz';
import { findTrack } from '../audio/model/project';
import type { TrackKind } from '../audio/model/types';
import { Timeline } from '../ui/Timeline';
import { StudioTimeline } from '../ui/StudioTimeline';

type Focus = { scope: 'master' | 'track' | 'bus'; id: string | null };
type Workspace = 'arrangement' | 'mixer' | 'processing';
type AssistantWindowRect = { x: number; y: number; width: number; height: number };
type AssistantPointer = {
  pointerId: number;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startRect: AssistantWindowRect;
};

const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const ASSISTANT_TOOLBAR_CLEARANCE = 112;

const TRACK_KINDS: TrackKind[] = ['audio', 'vocal', 'instrument', 'drums', 'bass', 'instrumental', 'stem'];

export default function Studio({ onStartTour, onExpandAssistant, onOpenAccount, onOpenCommandPalette }: { onStartTour?: () => void; onExpandAssistant?: () => void; onOpenAccount?: () => void; onOpenCommandPalette?: () => void } = {}) {
  const project = useApp((s) => s.project);
  const busy = useApp((s) => s.busy);
  const { selectedTrackId, selectTrack, importFiles, updateTrack, removeTrack, addTrack } = useApp();
  const picker = useFilePicker();
  const [focus, setFocus] = useState<Focus>({ scope: 'master', id: null });
  const [workspace, setWorkspace] = useState<Workspace>('arrangement');
  const [tracksOpen, setTracksOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  const assistantStageRef = useRef<HTMLDivElement | null>(null);
  const assistantPointerRef = useRef<AssistantPointer | null>(null);
  const [assistantWindowRect, setAssistantWindowRect] = useState<AssistantWindowRect | null>(null);
  const [trackScrollTop, setTrackScrollTop] = useState(0);
  const [processingCategory, setProcessingCategory] = useState<'effects' | 'eq' | 'dynamics' | null>('effects');
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('audio');
  const meters = useMeters();
  const selectedProcessorId = useApp((s) => s.selectedProcessorId);
  const activeTrack = project?.tracks.find((track) => track.id === selectedTrackId) ?? null;
  const setMasterVolume = useApp((s) => s.setMasterVolume);

  useEffect(() => {
    if (!assistantOpen) return;
    const stage = assistantStageRef.current;
    if (!stage) return;

    const fitAssistant = () => {
      const stageWidth = Math.max(320, stage.clientWidth);
      const stageHeight = Math.max(320, stage.clientHeight);
      setAssistantWindowRect((current) => {
        const width = Math.min(current?.width ?? 460, stageWidth - 24);
        const height = Math.min(current?.height ?? 560, Math.max(420, stageHeight - ASSISTANT_TOOLBAR_CLEARANCE - 20));
        return {
          width,
          height,
          x: current ? bound(current.x, 8, stageWidth - width - 8) : stageWidth - width - 20,
          y: current ? bound(current.y, 8, Math.max(8, stageHeight - height - ASSISTANT_TOOLBAR_CLEARANCE)) : 12,
        };
      });
    };

    fitAssistant();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitAssistant);
    observer?.observe(stage);
    return () => observer?.disconnect();
  }, [assistantOpen]);

  const startAssistantPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !assistantWindowRect) return;
    const resizing = Boolean(target.closest('[data-assistant-resize-handle]'));
    const dragging = Boolean(target.closest('[data-assistant-drag-handle]'));
    if (!resizing && (!dragging || target.closest('button, input, textarea, select, a'))) return;

    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId);
    assistantPointerRef.current = {
      pointerId: event.pointerId,
      mode: resizing ? 'resize' : 'move',
      startX: event.clientX,
      startY: event.clientY,
      startRect: assistantWindowRect,
    };
  };

  const moveAssistantPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = assistantPointerRef.current;
    const stage = assistantStageRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || !stage) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const start = interaction.startRect;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;

    if (interaction.mode === 'move') {
      setAssistantWindowRect({
        ...start,
        x: bound(start.x + dx, 8, stageWidth - start.width - 8),
        y: bound(start.y + dy, 8, Math.max(8, stageHeight - start.height - ASSISTANT_TOOLBAR_CLEARANCE)),
      });
      return;
    }

    const maxWidth = Math.min(760, stageWidth - start.x - 8);
    const maxHeight = Math.max(420, Math.min(820, stageHeight - start.y - ASSISTANT_TOOLBAR_CLEARANCE));
    setAssistantWindowRect({
      ...start,
      width: bound(start.width + dx, Math.min(340, maxWidth), maxWidth),
      height: bound(start.height + dy, Math.min(420, maxHeight), maxHeight),
    });
  };

  const endAssistantPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (assistantPointerRef.current?.pointerId !== event.pointerId) return;
    assistantPointerRef.current = null;
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const effectiveFocus: Focus = useMemo(() => {
    if (focus.scope === 'track' && !(project ? findTrack(project, focus.id) : undefined)) return { scope: 'master', id: null };
    if (focus.scope === 'bus' && !project?.buses.some((b) => b.id === focus.id)) return { scope: 'master', id: null };
    return focus;
  }, [focus, project]);

  if (!project) {
    return <div className="p-5"><Panel><EmptyState title="No project open" description="Create a project to access the mixing studio." action={<Button variant="primary" onClick={() => useApp.getState().setScreen('projects')}>Go to projects</Button>} /></Panel></div>;
  }

  const focusTrack = effectiveFocus.scope === 'track' ? findTrack(project, effectiveFocus.id) : null;
  const processors = effectiveFocus.scope === 'master' ? project.master.processors : effectiveFocus.scope === 'track' ? focusTrack?.processors ?? [] : project.buses.find((bus) => bus.id === effectiveFocus.id)?.processors ?? [];
  const focusLabel = effectiveFocus.scope === 'master' ? 'Master' : effectiveFocus.scope === 'bus' ? project.buses.find((bus) => bus.id === effectiveFocus.id)?.name ?? 'Bus' : focusTrack?.name ?? 'Track';
  const chooseTrack = (trackId: string) => { selectTrack(trackId); setFocus({ scope: 'track', id: trackId }); };
  const selectFocusValue = (value: string) => {
    if (value === 'master') { setFocus({ scope: 'master', id: null }); return; }
    const [scope, id] = value.split(':', 2);
    if (scope === 'track' && id) chooseTrack(id);
    else if (scope === 'bus' && id) setFocus({ scope: 'bus', id });
  };
  const focusValue = effectiveFocus.scope === 'master' ? 'master' : effectiveFocus.scope + ':' + (effectiveFocus.id ?? '');
  const openImport = (role: 'target' | 'stem' | 'reference') => { setAddOpen(false); picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, role)); };
  const createTrack = () => {
    addTrack(newTrackKind);
    const nextTrack = useApp.getState().project?.tracks.at(-1);
    if (nextTrack) chooseTrack(nextTrack.id);
    setAddOpen(false); setTracksOpen(true); setWorkspace('arrangement');
  };
  const removeTrackById = (trackId: string, name: string) => {
    if (window.confirm('Delete track "' + name + '"?')) {
      removeTrack(trackId);
      if (focus.scope === 'track' && focus.id === trackId) setFocus({ scope: 'master', id: null });
    }
  };



  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-sonora-canvas text-ink-100">
      <header className="relative z-30 flex h-[88px] shrink-0 items-center justify-between gap-5 border-b border-white/[.07] bg-[#0D0D1B]/92 px-6 shadow-[0_8px_28px_rgba(0,0,0,.16)] backdrop-blur-xl sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#A77AFF]/35 bg-gradient-to-br from-[#8957FF]/25 to-[#7545EA]/10 text-[#C4A2FF] shadow-violet-soft">
            <Icon name="audio-lines" size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-[-.02em] text-white">Sonora</h1>
            <p className="max-w-[180px] truncate text-xs text-ink-400">{project.name} · {project.tracks.length} tracks · {(project.sampleRate / 1000).toFixed(1)} kHz</p>
          </div>
        </div>

        <nav aria-label="Studio navigation" className="no-scrollbar flex min-w-0 items-center justify-center gap-0.5 overflow-x-auto px-1">
          <button type="button" onClick={() => setWorkspace('arrangement')} aria-current="page" className="relative flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#8957FF]/15 px-4 text-xs font-medium text-white transition-colors sm:px-5 sm:text-sm">
            <Icon name="waveform" size={15} className="text-[#C4A2FF]" /> Studio
            <span className="absolute inset-x-4 -bottom-[1px] h-[2px] rounded-full bg-gradient-to-r from-[#8957FF] to-[#C4A2FF]" />
          </button>
          <button type="button" onClick={() => useApp.getState().setScreen('reference')} className="focus-ring flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-medium text-ink-400 transition-colors hover:bg-white/[.04] hover:text-white sm:px-5 sm:text-sm">
            <Icon name="audio-lines" size={15} className="text-ink-500" /> Reference
          </button>
          <button type="button" onClick={() => setAssistantOpen((open) => !open)} aria-pressed={assistantOpen} className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-medium transition-colors sm:px-5 sm:text-sm ${assistantOpen ? 'bg-[#8957FF]/15 text-[#C4A2FF]' : 'text-ink-400 hover:bg-white/[.04] hover:text-white'}`}>
            <Icon name="sparkles" size={15} /> AI Assistant
          </button>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onOpenCommandPalette} title="Search Sonora (⌘K / Ctrl+K)" aria-label="Search Sonora" className="focus-ring inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-2.5 text-ink-300 transition-colors hover:border-[#A77AFF]/35 hover:bg-[#8957FF]/[.08] hover:text-[#C4A2FF] sm:px-3">
            <Icon name="search" size={17} />
            <span className="hidden text-xs font-medium xl:inline">Search</span>
            <kbd className="hidden rounded border border-white/[.1] px-1.5 py-0.5 font-mono text-[9px] text-ink-500 xl:inline">⌘K</kbd>
          </button>
          <button type="button" data-tour="studio-tracks" onClick={() => setTracksOpen(true)} title="Manage tracks and buses" aria-label={`Open tracks, ${project.tracks.length} tracks`} className="inline-flex h-10 items-center rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 text-xs text-ink-300 transition-colors hover:bg-white/[.06] hover:text-white">
            Tracks <span className="ml-1 text-ink-500">{project.tracks.length}</span>
          </button>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={14} /> Add audio</Button>
          <button type="button" onClick={onStartTour} title="Guided tour" aria-label="Start guided tour" className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#A77AFF]/25 bg-[#8957FF]/[.08] px-3 text-xs font-medium text-[#C4A2FF] transition-colors hover:border-[#A77AFF]/45 hover:bg-[#8957FF]/15">
            <Icon name="sparkles" size={14} /> <span className="hidden md:inline">Tour</span>
          </button>
          <button type="button" onClick={() => useApp.getState().setScreen('settings')} aria-label="Settings" title="Settings" className="focus-ring hidden h-10 w-10 items-center justify-center rounded-full border border-white/[.10] bg-[#1D1D30] text-ink-300 transition-colors hover:border-[#A77AFF]/50 hover:text-white sm:inline-flex">
            <Icon name="sliders" size={17} />
          </button>
          <button type="button" onClick={() => onOpenAccount?.() ?? useApp.getState().setScreen('account')} aria-label="Open Sonora account" title="Account" className="focus-ring hidden h-10 w-10 items-center justify-center rounded-full border border-[#A77AFF]/40 bg-gradient-to-br from-[#8957FF]/35 to-[#7545EA]/15 text-[11px] font-semibold text-white transition hover:border-[#A77AFF]/70 hover:brightness-110 sm:flex">S</button>
        </div>
      </header>

      <div data-tour="studio-transport" className="shrink-0"><TransportBar /></div>
      <StudioTimeline />

      <div ref={assistantStageRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside data-tour="studio-tracks" className="hidden w-[220px] shrink-0 flex-col border-r border-white/[.07] bg-[#0D0D1B]/92 lg:flex xl:w-[240px]">
          <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-white/[.07] px-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-100">Tracks</span>
              <span className="font-mono text-[9px] text-ink-500">{project.tracks.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton title="Manage tracks and buses" onClick={() => setTracksOpen(true)}><Icon name="sliders" size={14} /></IconButton>
              <FlyoutMenu
                label=""
                icon="sliders"
                title={activeTrack ? `${activeTrack.name} settings` : 'Track settings'}
                description="Secondary channel controls. The main level, mute and solo controls stay visible beside the timeline."
                placement="bottom-start"
                width="md"
                triggerClassName="!h-8 !min-h-8 !w-8 !px-0 !py-0"
                disabled={!activeTrack}
              >
                {activeTrack ? (
                  <>
                    <ParamSlider
                      label="Pan"
                      value={activeTrack.pan}
                      min={-100}
                      max={100}
                      step={1}
                      format={(value) => value === 0 ? 'Center' : `${Math.abs(value).toFixed(0)}${value > 0 ? ' R' : ' L'}`}
                      onChange={(value) => updateTrack(activeTrack.id, { pan: value })}
                    />
                    <Toggle checked={activeTrack.polarity} onChange={(value) => updateTrack(activeTrack.id, { polarity: value })} label="Invert polarity" description="Flip the track's signal polarity." />
                    <Toggle checked={activeTrack.mono} onChange={(value) => updateTrack(activeTrack.id, { mono: value })} label="Mono fold-down" description="Sum this track to mono before its processor chain." />
                  </>
                ) : <p className="text-2xs text-ink-500">Select a track to edit its secondary channel settings.</p>}
              </FlyoutMenu>
              <button type="button" title="Add audio or track" onClick={() => setAddOpen(true)} className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-[#A77AFF]/30 bg-[#8957FF]/15 text-[#C4A2FF] transition-all hover:bg-[#8957FF]/25">
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="h-9 shrink-0 border-b border-white/[.055] bg-[#11111F]" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={(event) => setTrackScrollTop(event.currentTarget.scrollTop)}>
              {project.tracks.map((track) => {
                const trackIcon = track.kind === 'vocal' ? 'microphone' : track.kind === 'drums' ? 'audio-lines' : track.kind === 'bass' ? 'guitar' : track.kind === 'reference' ? 'headphones' : 'music';
                return (
                  <div key={track.id} className={`flex h-[82px] flex-col justify-center border-b border-white/[.055] px-3 transition-colors ${selectedTrackId === track.id ? 'bg-[#8957FF]/[.09]' : 'hover:bg-white/[.025]'}`}>
                    <div className="flex min-w-0 items-center gap-2">
                      <button type="button" onClick={() => chooseTrack(track.id)} aria-label={`Select ${track.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <Icon name={trackIcon} size={25} className="shrink-0" style={{ color: track.color }} />
                        <span className="min-w-0 truncate text-[11px] font-medium text-ink-100">{track.name}</span>
                      </button>
                      <button type="button" title={track.soloed ? 'Unsolo track' : 'Solo track'} aria-pressed={track.soloed} onClick={() => updateTrack(track.id, { soloed: !track.soloed })} className={`h-7 min-w-7 rounded-lg border px-1 text-[10px] font-semibold transition-colors ${track.soloed ? 'border-[#A77AFF]/50 bg-[#8957FF]/20 text-[#C4A2FF]' : 'border-white/[.08] bg-[#171727] text-ink-500 hover:text-ink-100'}`}>S</button>
                      <button type="button" title={track.muted ? 'Unmute track' : 'Mute track'} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })} className={`h-6 min-w-6 rounded-md border px-1 text-[9px] font-semibold transition-colors ${track.muted ? 'border-signal-red/40 bg-signal-red/10 text-signal-red' : 'border-white/[.08] bg-[#171727] text-ink-500 hover:text-ink-100'}`}>M</button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-7">
                      <input aria-label={`${track.name} volume`} type="range" min={-60} max={6} step={0.5} value={track.volumeDb} onChange={(event) => updateTrack(track.id, { volumeDb: Number(event.target.value) })} className="min-w-0 flex-1" />
                      <span className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-ink-500">{track.volumeDb.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
              {project.tracks.length === 0 && <div className="px-3 py-8 text-center text-2xs text-ink-500">No tracks yet. Add audio to begin.</div>}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/[.07] bg-[#11111F] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-100">Master</span>
              <span className="font-mono text-2xs tabular-nums text-ink-400">{project.master.volumeDb.toFixed(1)} dB</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 items-end gap-1">
                <LevelMeter db={meters.peakL} peakDb={meters.peakL} height={42} width={7} />
                <LevelMeter db={meters.peakR} peakDb={meters.peakR} height={42} width={7} />
              </div>
              <div className="min-w-0 flex-1">
                <input aria-label="Master output level" type="range" min={-24} max={6} step={0.1} value={project.master.volumeDb} onChange={(event) => setMasterVolume(Number(event.target.value))} className="w-full" />
                <div className="mt-1 flex items-center justify-between text-[9px] text-ink-500">
                  <span>Output</span><Icon name="volume" size={13} />
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-white/[.07] bg-[#11111F] px-5">
            <div className="flex items-center gap-1 rounded-xl border border-white/[.07] bg-black/20 p-1">
              {(['arrangement', 'mixer', 'processing'] as Workspace[]).map((tab) => (
                <button key={tab} type="button" onClick={() => setWorkspace(tab)} aria-pressed={workspace === tab} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium capitalize transition-colors ${workspace === tab ? 'bg-[#8957FF]/20 text-[#C4A2FF] shadow-violet-soft' : 'text-ink-500 hover:text-ink-200'}`}>
                  {tab === 'arrangement' ? 'Arrangement' : tab === 'mixer' ? 'Mixer' : 'Processing'}
                </button>
              ))}
            </div>
            <span className="hidden w-[240px] shrink-0 whitespace-nowrap text-right text-xs text-ink-500 sm:inline">{workspace === 'arrangement' ? 'Arrange and edit your tracks' : workspace === 'mixer' ? 'Balance channels and buses' : 'Shape your sound'}</span>
          </div>

          <div data-tour="studio-timeline" className="studio-fixed-frame min-h-0 flex-1 overflow-hidden bg-[#090914]">
            <div key={workspace + (workspace === 'processing' ? processingCategory : '')} className="studio-workspace-motion flex h-full min-h-0 flex-col">
              {workspace === 'arrangement' && (
                <Timeline onSelectTrack={chooseTrack} showTrackHeaders={false} externalScrollTop={trackScrollTop} onVerticalScroll={setTrackScrollTop} />
              )}
              {workspace === 'mixer' && (
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="flex min-h-0 flex-1 overflow-auto">
                    <Mixer focus={effectiveFocus} onFocus={(scope, id) => setFocus({ scope, id })} />
                  </div>
                </div>
              )}
              {workspace === 'processing' && (
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center justify-between border-b border-white/[.06] px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink-100">{processingCategory === 'eq' ? 'Equalizer' : processingCategory === 'dynamics' ? 'Dynamics' : 'Effects'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-ink-500">{focusLabel} · {processors.filter((processor) => processor.enabled).length} active / {processors.length} total</p>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-ink-500">Channel
                        <select aria-label="Choose channel processing chain" value={focusValue} onChange={(event) => selectFocusValue(event.target.value)} className="max-w-[180px] rounded-control border border-white/[.09] bg-[#171727] px-2 py-1.5 text-xs text-ink-100">
                          <option value="master">Master</option>
                          {project.tracks.map((track) => <option key={track.id} value={'track:' + track.id}>{track.name}</option>)}
                          {project.buses.map((bus) => <option key={bus.id} value={'bus:' + bus.id}>{bus.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <Rack
                        scope={effectiveFocus.scope}
                        trackId={effectiveFocus.id}
                        processors={processors}
                        selectedId={selectedProcessorId}
                        onSelect={(id) => useApp.getState().selectProcessor(id)}
                        meters={meters.gr[effectiveFocus.scope === 'master' ? 'master' : effectiveFocus.id ?? ''] ?? {}}
                        emptyHint={effectiveFocus.scope === 'master' ? 'Add mastering processors or generate a chain from Reference Match.' : 'Add processors to this channel or load a preset.'}
                        filterCategory={processingCategory}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div data-tour="studio-processing" className="flex h-[92px] shrink-0 items-center justify-center border-t border-white/[.07] bg-[#0D0D1B]/95 px-3 sm:h-[104px] sm:px-6">
            <div className="grid w-full max-w-[760px] grid-cols-5 gap-3">
              {[
                { id: 'mix', label: 'Mix', icon: 'sliders' as const, action: () => setWorkspace('arrangement'), active: workspace === 'arrangement' || workspace === 'mixer' },
                { id: 'effects', label: 'Effects', icon: 'sparkles' as const, action: () => { setWorkspace('processing'); setProcessingCategory('effects'); }, active: workspace === 'processing' && processingCategory === 'effects' },
                { id: 'eq', label: 'EQ', icon: 'equalizer' as const, action: () => { setWorkspace('processing'); setProcessingCategory('eq'); }, active: workspace === 'processing' && processingCategory === 'eq' },
                { id: 'dynamics', label: 'Dynamics', icon: 'activity' as const, action: () => { setWorkspace('processing'); setProcessingCategory('dynamics'); }, active: workspace === 'processing' && processingCategory === 'dynamics' },
                { id: 'export', label: 'Export', icon: 'download' as const, action: () => useApp.getState().setScreen('export'), active: false },
              ].map((item) => (
                <button key={item.id} type="button" onClick={item.action} aria-pressed={item.active} className={`group flex h-[76px] flex-col items-center justify-center gap-2 rounded-2xl border transition-colors duration-150 sm:h-[84px] sm:gap-2.5 ${item.active ? 'border-[#A77AFF]/55 bg-[#8957FF]/15 text-white shadow-violet-soft' : 'border-white/[.055] bg-[#171727]/70 text-ink-400 hover:border-white/[.14] hover:bg-[#1D1D30] hover:text-ink-100'}`}>
                  <Icon name={item.icon} size={24} className={item.active ? 'text-[#C4A2FF]' : 'text-ink-400 group-hover:text-ink-100'} />
                  <span className="text-xs font-semibold sm:text-sm">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {assistantOpen && (
          <>
            {assistantWindowRect && (
              <div
                data-tour="studio-assistant"
                className="absolute z-40 hidden min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[.12] bg-[#0D0D1B]/[.98] shadow-[0_24px_80px_rgba(0,0,0,.58)] backdrop-blur-xl xl:flex"
                style={{
                  left: assistantWindowRect.x,
                  top: assistantWindowRect.y,
                  width: assistantWindowRect.width,
                  height: assistantWindowRect.height,
                }}
                onPointerDown={startAssistantPointer}
                onPointerMove={moveAssistantPointer}
                onPointerUp={endAssistantPointer}
                onPointerCancel={endAssistantPointer}
                onLostPointerCapture={() => { assistantPointerRef.current = null; }}
              >
                <div className="min-h-0 flex-1"><AssistantPanel draggable onClose={() => setAssistantOpen(false)} onExpand={() => { setAssistantOpen(false); onExpandAssistant?.(); }} /></div>
                <button
                  type="button"
                  data-assistant-resize-handle
                  aria-label="Resize Sonora AI window"
                  title="Drag to resize, or use arrow keys"
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 40 : 16;
                    const widthDelta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
                    const heightDelta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
                    if (!widthDelta && !heightDelta) return;
                    event.preventDefault();
                    const stage = assistantStageRef.current;
                    if (!stage) return;
                    setAssistantWindowRect((current) => {
                      if (!current) return current;
                      const maxWidth = Math.min(760, stage.clientWidth - current.x - 8);
                      const maxHeight = Math.max(420, Math.min(820, stage.clientHeight - current.y - ASSISTANT_TOOLBAR_CLEARANCE));
                      return {
                        ...current,
                        width: bound(current.width + widthDelta, Math.min(340, maxWidth), maxWidth),
                        height: bound(current.height + heightDelta, Math.min(420, maxHeight), maxHeight),
                      };
                    });
                  }}
                  className="absolute bottom-1.5 right-1.5 z-10 flex h-6 w-6 touch-none items-center justify-center rounded-md border border-white/[.10] bg-[#171727]/90 text-sm leading-none text-ink-500 shadow-lg hover:border-[#A77AFF]/45 hover:text-[#C4A2FF]"
                >
                  ⤢
                </button>
              </div>
            )}
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#05050c]/65 p-3 backdrop-blur-sm sm:p-5 xl:hidden" onClick={() => setAssistantOpen(false)}>
              <aside
                data-tour="studio-assistant"
                className="flex h-full max-h-[calc(100dvh-24px)] w-full max-w-[640px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[.10] bg-[#0D0D1B] shadow-floating"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="min-h-0 flex-1"><AssistantPanel onClose={() => setAssistantOpen(false)} onExpand={() => { setAssistantOpen(false); onExpandAssistant?.(); }} /></div>
              </aside>
            </div>
          </>
        )}
      </div>

      <Modal open={tracksOpen} onClose={() => setTracksOpen(false)} title="Session tracks" wide>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="space-y-1">
            {project.tracks.length === 0 && <p className="py-6 text-center text-xs text-ink-500">No tracks yet. Add audio or create a track.</p>}
            {project.tracks.map((track) => (
              <div key={track.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${selectedTrackId === track.id ? 'border-violet-400/40 bg-violet-500/10' : 'border-ink-700 bg-ink-900/50'}`}>
                <button type="button" onClick={() => { chooseTrack(track.id); setTracksOpen(false); }} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: track.color }} /><span className="truncate text-xs font-medium text-ink-100">{track.name}</span>{track.kind === 'reference' && <Badge tone="info">Reference</Badge>}</span><span className="mt-1 block text-2xs text-ink-500">{track.clips.length} clips · {track.processors.length} processors</span></button>
                <button type="button" title={track.muted ? 'Unmute track' : 'Mute track'} aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })} className="rounded border border-ink-600 px-2 py-1 text-2xs text-ink-400">M</button>
                <button type="button" title={track.soloed ? 'Unsolo track' : 'Solo track'} aria-label={track.soloed ? `Unsolo ${track.name}` : `Solo ${track.name}`} aria-pressed={track.soloed} onClick={() => updateTrack(track.id, { soloed: !track.soloed })} className="rounded border border-ink-600 px-2 py-1 text-2xs text-ink-400">S</button>
                <button type="button" title={`Delete ${track.name}`} onClick={() => removeTrackById(track.id, track.name)} className="rounded border border-ink-700 px-2 py-1 text-2xs text-ink-500 hover:text-red-300">Delete</button>
                <div className="flex w-full items-center gap-2">
                  <input aria-label={`${track.name} volume`} type="range" min={-60} max={6} step={0.5} value={track.volumeDb} onChange={(event) => updateTrack(track.id, { volumeDb: Number(event.target.value) })} className="min-w-0 flex-1" />
                  <span className="w-12 text-right font-mono text-2xs tabular-nums text-ink-400">{track.volumeDb.toFixed(1)} dB</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3"><p className="text-xs font-semibold text-ink-100">Track tools</p><p className="mt-1 text-2xs leading-relaxed text-ink-500">Create and organise the channels in this session.</p><div className="mt-4 border-t border-ink-700 pt-3"><div className="mb-1 flex items-center justify-between"><span className="text-2xs font-medium text-ink-300">Master output</span><span className="font-mono text-2xs text-ink-400">{project.master.volumeDb.toFixed(1)} dB</span></div><input aria-label="Master output level" type="range" min={-24} max={6} step={0.1} value={project.master.volumeDb} onChange={(event) => setMasterVolume(Number(event.target.value))} className="w-full" /></div><label className="mt-4 block text-2xs text-ink-400">Track type<select value={newTrackKind} onChange={(event) => setNewTrackKind(event.target.value as TrackKind)} className="mt-1 w-full rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-100">{TRACK_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label><Button className="mt-2 w-full" size="sm" onClick={createTrack}>＋ Create track</Button><Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => useApp.getState().addBus('Bus ' + (project.buses.length + 1))}>＋ Add bus</Button>{project.buses.length > 0 && <div className="mt-4 border-t border-ink-700 pt-3"><p className="text-2xs font-medium text-ink-300">Buses</p>{project.buses.map((bus) => <button key={bus.id} type="button" onClick={() => { setFocus({ scope: 'bus', id: bus.id }); setTracksOpen(false); setWorkspace('processing'); }} className="mt-1 block w-full rounded px-2 py-1.5 text-left text-2xs text-ink-400 hover:bg-ink-800 hover:text-ink-100">{bus.name} <span className="text-ink-600">· open chain</span></button>)}</div>}</div>
        </div>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add to session">
        <div className="grid gap-2">
          <button type="button" onClick={() => openImport('target')} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-left hover:border-violet-400/40"><span className="block text-xs font-medium text-ink-100">Import a song</span><span className="mt-1 block text-2xs text-ink-500">Add the main mix you want to work on.</span></button>
          <button type="button" onClick={() => openImport('stem')} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-left hover:border-violet-400/40"><span className="block text-xs font-medium text-ink-100">Import stems</span><span className="mt-1 block text-2xs text-ink-500">Bring in separate vocal, drum, bass or instrument files.</span></button>
          <button type="button" onClick={() => openImport('reference')} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-left hover:border-violet-400/40"><span className="block text-xs font-medium text-ink-100">Add a reference track</span><span className="mt-1 block text-2xs text-ink-500">Compare your sound with a track you admire.</span></button>
          <div className="mt-2 border-t border-ink-700 pt-3"><p className="mb-2 text-2xs font-medium text-ink-300">Create a track</p><div className="flex gap-2"><select value={newTrackKind} onChange={(event) => setNewTrackKind(event.target.value as TrackKind)} className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-100">{TRACK_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select><Button size="sm" onClick={createTrack}>＋ Track</Button></div></div>
        </div>
      </Modal>
    </div>
  );
}
