import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, IconButton, Modal, Panel, useFilePicker } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { Mixer, TransportBar, AssistantPanel } from '../ui/Mixer';
import { Rack } from '../ui/Rack';
import { LevelMeter, useMeters } from '../ui/viz';
import { findTrack } from '../audio/model/project';
import type { TrackKind } from '../audio/model/types';
import { Timeline } from '../ui/Timeline';

type Focus = { scope: 'master' | 'track' | 'bus'; id: string | null };
type Workspace = 'arrangement' | 'mixer' | 'processing';

const TRACK_KINDS: TrackKind[] = ['audio', 'vocal', 'instrument', 'drums', 'bass', 'instrumental', 'stem'];

export default function Studio() {
  const project = useApp((s) => s.project);
  const { selectedTrackId, selectTrack, importFiles, updateTrack, removeTrack, addTrack } = useApp();
  const picker = useFilePicker();
  const [focus, setFocus] = useState<Focus>({ scope: 'master', id: null });
  const [workspace, setWorkspace] = useState<Workspace>('arrangement');
  const [tracksOpen, setTracksOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [trackScrollTop, setTrackScrollTop] = useState(0);
  const [processingCategory, setProcessingCategory] = useState<'effects' | 'eq' | 'dynamics' | null>('effects');
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('audio');
  const meters = useMeters();
  const selectedProcessorId = useApp((s) => s.selectedProcessorId);
  const setMasterVolume = useApp((s) => s.setMasterVolume);

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
    <div className="flex h-full min-h-0 flex-col bg-sonora-canvas text-ink-100">
      <header className="relative z-30 flex h-[62px] shrink-0 items-center justify-between gap-3 border-b border-white/[.07] bg-[#0D0D1B]/92 px-3 shadow-[0_8px_28px_rgba(0,0,0,.16)] backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#A77AFF]/35 bg-gradient-to-br from-[#8957FF]/25 to-[#7545EA]/10 text-[#C4A2FF] shadow-violet-soft">
            <Icon name="audio-lines" size={21} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-[-.02em] text-white">Sonora</h1>
            <p className="max-w-[180px] truncate text-[10px] text-ink-500">{project.name} · {project.tracks.length} tracks · {(project.sampleRate / 1000).toFixed(1)} kHz</p>
          </div>
          <Badge tone="neutral" className="hidden lg:inline-flex">{project.autosave ? 'Autosave on' : 'Manual save'}</Badge>
        </div>

        <nav aria-label="Studio navigation" className="no-scrollbar flex min-w-0 items-center justify-center gap-0.5 overflow-x-auto px-1">
          <button type="button" onClick={() => setWorkspace('arrangement')} aria-current={workspace === 'arrangement' ? 'page' : undefined} className={`relative flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium transition-all sm:px-4 sm:text-xs ${workspace === 'arrangement' ? 'bg-[#8957FF]/15 text-white' : 'text-ink-400 hover:bg-white/[.04] hover:text-white'}`}>
            <Icon name="waveform" size={15} className={workspace === 'arrangement' ? 'text-[#C4A2FF]' : 'text-ink-500'} /> Studio
            {workspace === 'arrangement' && <span className="absolute inset-x-4 -bottom-[1px] h-[2px] rounded-full bg-gradient-to-r from-[#8957FF] to-[#C4A2FF]" />}
          </button>
          <button type="button" onClick={() => useApp.getState().setScreen('mastering')} className="flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium text-ink-400 transition-colors hover:bg-white/[.04] hover:text-white sm:px-4 sm:text-xs">
            <Icon name="equalizer" size={15} className="text-ink-500" /> Mastering
          </button>
          <button type="button" onClick={() => useApp.getState().setScreen('reference')} className="flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium text-ink-400 transition-colors hover:bg-white/[.04] hover:text-white sm:px-4 sm:text-xs">
            <Icon name="audio-lines" size={15} className="text-ink-500" /> Reference
          </button>
          <button type="button" onClick={() => setAssistantOpen((open) => !open)} aria-pressed={assistantOpen} className={`flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium transition-colors sm:px-4 sm:text-xs ${assistantOpen ? 'bg-[#8957FF]/15 text-[#C4A2FF]' : 'text-ink-400 hover:bg-white/[.04] hover:text-white'}`}>
            <Icon name="sparkles" size={15} /> AI Assistant
          </button>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => setTracksOpen(true)} title="Manage tracks and buses" className="hidden rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 py-2 text-[10px] text-ink-300 transition-colors hover:bg-white/[.06] hover:text-white lg:inline-flex">
            Tracks <span className="ml-1 text-ink-500">{project.tracks.length}</span>
          </button>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={14} /> Add audio</Button>
          <button type="button" onClick={() => useApp.getState().setScreen('settings')} aria-label="Settings" title="Settings" className="focus-ring hidden h-8 w-8 items-center justify-center rounded-full border border-white/[.10] bg-[#1D1D30] text-ink-300 transition-colors hover:border-[#A77AFF]/50 hover:text-white sm:inline-flex">
            <Icon name="settings" size={15} />
          </button>
          <span className="hidden h-8 w-8 items-center justify-center rounded-full border border-[#A77AFF]/40 bg-gradient-to-br from-[#8957FF]/35 to-[#7545EA]/15 text-[11px] font-semibold text-white sm:flex" title="Sonora profile">S</span>
        </div>
      </header>

      <TransportBar />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[204px] shrink-0 flex-col border-r border-white/[.07] bg-[#0D0D1B]/92 sm:w-[220px]">
          <div className="flex h-[43px] shrink-0 items-center justify-between border-b border-white/[.07] px-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-100">Tracks</span>
              <span className="font-mono text-[9px] text-ink-500">{project.tracks.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton title="Manage tracks and buses" onClick={() => setTracksOpen(true)}><Icon name="settings" size={14} /></IconButton>
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
                  <div key={track.id} className={`flex h-[72px] flex-col justify-center border-b border-white/[.055] px-3 transition-colors ${selectedTrackId === track.id ? 'bg-[#8957FF]/[.09]' : 'hover:bg-white/[.025]'}`}>
                    <div className="flex min-w-0 items-center gap-2">
                      <button type="button" onClick={() => chooseTrack(track.id)} aria-label={`Select ${track.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <Icon name={trackIcon} size={22} className="shrink-0" style={{ color: track.color }} />
                        <span className="min-w-0 truncate text-[11px] font-medium text-ink-100">{track.name}</span>
                      </button>
                      <button type="button" title={track.soloed ? 'Unsolo track' : 'Solo track'} aria-pressed={track.soloed} onClick={() => updateTrack(track.id, { soloed: !track.soloed })} className={`h-6 min-w-6 rounded-md border px-1 text-[9px] font-semibold transition-colors ${track.soloed ? 'border-[#A77AFF]/50 bg-[#8957FF]/20 text-[#C4A2FF]' : 'border-white/[.08] bg-[#171727] text-ink-500 hover:text-ink-100'}`}>S</button>
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

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[43px] shrink-0 items-center justify-between gap-2 border-b border-white/[.07] bg-[#11111F] px-3">
            <div className="flex items-center gap-1 rounded-xl border border-white/[.07] bg-black/20 p-1">
              {(['arrangement', 'mixer', 'processing'] as Workspace[]).map((tab) => (
                <button key={tab} type="button" onClick={() => setWorkspace(tab)} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium capitalize transition-all ${workspace === tab ? 'bg-[#8957FF]/20 text-[#C4A2FF] shadow-violet-soft' : 'text-ink-500 hover:text-ink-200'}`}>
                  {tab === 'arrangement' ? 'Arrangement' : tab === 'mixer' ? 'Mixer' : 'Processing'}
                </button>
              ))}
            </div>
            <span className="hidden text-[10px] text-ink-500 sm:inline">{workspace === 'arrangement' ? 'Arrange and edit your tracks' : workspace === 'mixer' ? 'Balance channels and buses' : 'Shape your sound'}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-[#090914]">
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

          <div className="flex h-[82px] shrink-0 items-center justify-center border-t border-white/[.07] bg-[#0D0D1B]/95 px-3">
            <div className="grid w-full max-w-[600px] grid-cols-5 gap-2">
              {[
                { id: 'mix', label: 'Mix', icon: 'sliders' as const, action: () => setWorkspace('arrangement'), active: workspace !== 'processing' },
                { id: 'effects', label: 'Effects', icon: 'sparkles' as const, action: () => { setWorkspace('processing'); setProcessingCategory('effects'); }, active: workspace === 'processing' && processingCategory === 'effects' },
                { id: 'eq', label: 'EQ', icon: 'equalizer' as const, action: () => { setWorkspace('processing'); setProcessingCategory('eq'); }, active: workspace === 'processing' && processingCategory === 'eq' },
                { id: 'dynamics', label: 'Dynamics', icon: 'activity' as const, action: () => { setWorkspace('processing'); setProcessingCategory('dynamics'); }, active: workspace === 'processing' && processingCategory === 'dynamics' },
                { id: 'export', label: 'Export', icon: 'download' as const, action: () => useApp.getState().setScreen('export'), active: false },
              ].map((item) => (
                <button key={item.id} type="button" onClick={item.action} aria-pressed={item.active} className={`group flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-xl border transition-all duration-180 ${item.active ? 'border-[#A77AFF]/55 bg-[#8957FF]/15 text-white shadow-violet-soft' : 'border-white/[.055] bg-[#171727]/70 text-ink-400 hover:border-white/[.14] hover:bg-[#1D1D30] hover:text-ink-100'}`}>
                  <Icon name={item.icon} size={21} className={item.active ? 'text-[#C4A2FF]' : 'text-ink-400 group-hover:text-ink-100'} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {assistantOpen && (
          <aside className="hidden w-[280px] shrink-0 border-l border-white/[.07] bg-[#0D0D1B] xl:flex 2xl:w-[310px]">
            <div className="min-h-0 flex-1"><AssistantPanel onClose={() => setAssistantOpen(false)} /></div>
          </aside>
        )}
      </div>

      <Modal open={tracksOpen} onClose={() => setTracksOpen(false)} title="Session tracks" wide>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="space-y-1">
            {project.tracks.length === 0 && <p className="py-6 text-center text-xs text-ink-500">No tracks yet. Add audio or create a track.</p>}
            {project.tracks.map((track) => (
              <div key={track.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${selectedTrackId === track.id ? 'border-violet-400/40 bg-violet-500/10' : 'border-ink-700 bg-ink-900/50'}`}>
                <button type="button" onClick={() => { chooseTrack(track.id); setTracksOpen(false); }} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: track.color }} /><span className="truncate text-xs font-medium text-ink-100">{track.name}</span>{track.kind === 'reference' && <Badge tone="info">Reference</Badge>}</span><span className="mt-1 block text-2xs text-ink-500">{track.clips.length} clips · {track.processors.length} processors</span></button>
                <button type="button" title="Mute track" aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })} className="rounded border border-ink-600 px-2 py-1 text-2xs text-ink-400">M</button>
                <button type="button" title="Solo track" aria-pressed={track.soloed} onClick={() => updateTrack(track.id, { soloed: !track.soloed })} className="rounded border border-ink-600 px-2 py-1 text-2xs text-ink-400">S</button>
                <button type="button" title="Delete track" onClick={() => removeTrackById(track.id, track.name)} className="rounded border border-ink-700 px-2 py-1 text-2xs text-ink-500 hover:text-red-300">Delete</button>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3"><p className="text-xs font-semibold text-ink-100">Track tools</p><p className="mt-1 text-2xs leading-relaxed text-ink-500">Create and organise the channels in this session.</p><label className="mt-4 block text-2xs text-ink-400">Track type<select value={newTrackKind} onChange={(event) => setNewTrackKind(event.target.value as TrackKind)} className="mt-1 w-full rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-100">{TRACK_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label><Button className="mt-2 w-full" size="sm" onClick={createTrack}>＋ Create track</Button><Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => useApp.getState().addBus('Bus ' + (project.buses.length + 1))}>＋ Add bus</Button>{project.buses.length > 0 && <div className="mt-4 border-t border-ink-700 pt-3"><p className="text-2xs font-medium text-ink-300">Buses</p>{project.buses.map((bus) => <button key={bus.id} type="button" onClick={() => { setFocus({ scope: 'bus', id: bus.id }); setTracksOpen(false); setWorkspace('processing'); }} className="mt-1 block w-full rounded px-2 py-1.5 text-left text-2xs text-ink-400 hover:bg-ink-800 hover:text-ink-100">{bus.name} <span className="text-ink-600">· open chain</span></button>)}</div>}</div>
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
