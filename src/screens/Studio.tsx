import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, Modal, Panel, useFilePicker } from '../ui/Primitives';
import { Mixer, TransportBar, AssistantPanel } from '../ui/Mixer';
import { Rack } from '../ui/Rack';
import { useMeters } from '../ui/viz';
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
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('audio');
  const meters = useMeters();
  const selectedProcessorId = useApp((s) => s.selectedProcessorId);

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

  const navItems = [
    { label: 'Studio', glyph: '⌁', action: () => setWorkspace('arrangement'), active: workspace === 'arrangement' },
    { label: 'Reference', glyph: '◇', action: () => useApp.getState().setScreen('reference'), active: false },
    { label: 'Mastering', glyph: '♜', action: () => useApp.getState().setScreen('mastering'), active: false },
    { label: 'AI Assistant', glyph: '✦', action: () => setAssistantOpen((open) => !open), active: assistantOpen },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#090812] text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-violet-300/10 bg-[#0d0b18] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lg text-lime-300">≋</div>
          <div className="min-w-0">
            <h1 className="max-w-[220px] truncate text-sm font-semibold tracking-wide text-white">SONORA <span className="font-normal text-slate-500">/ {project.name}</span></h1>
            <p className="mt-0.5 text-[10px] text-slate-500">{project.tracks.length} tracks · {project.sampleRate / 1000} kHz session</p>
          </div>
          <Badge tone="neutral">{project.autosave ? 'Autosave on' : 'Manual save'}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setTracksOpen(true)}>Tracks <span className="ml-1 text-slate-500">{project.tracks.length}</span></Button>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>＋ Add audio</Button>
        </div>
      </header>

      <TransportBar />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[154px] shrink-0 flex-col border-r border-violet-300/10 bg-[#0d0b18] p-3 sm:flex">
          <p className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[.2em] text-slate-600">Workspace</p>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button key={item.label} type="button" onClick={item.action} className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${item.active ? 'border-violet-400/25 bg-violet-500/20 text-white shadow-[inset_2px_0_0_#9b63ff]' : 'border-transparent text-slate-400 hover:bg-white/[.04] hover:text-white'}`}>
                <span className={`text-base ${item.active ? 'text-violet-300' : 'text-slate-500'}`}>{item.glyph}</span>{item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-1 border-t border-white/[.06] pt-3">
            <button type="button" onClick={() => useApp.getState().setScreen('settings')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white/[.04] hover:text-white"><span>⚙</span> Settings</button>
            <button type="button" onClick={() => useApp.getState().setScreen('learn')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-white/[.04] hover:text-white"><span>ⓘ</span> Help</button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-violet-300/10 bg-[#100e1c] px-3 py-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/[.06] bg-black/20 p-1">
              {(['arrangement', 'mixer', 'processing'] as Workspace[]).map((tab) => (
                <button key={tab} type="button" onClick={() => setWorkspace(tab)} className={`rounded-lg px-3 py-1.5 text-[11px] font-medium capitalize transition-colors ${workspace === tab ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/40' : 'text-slate-500 hover:text-slate-200'}`}>{tab === 'arrangement' ? 'Arrangement' : tab}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span className="hidden md:inline">{workspace === 'arrangement' ? 'Arrange and edit your tracks' : workspace === 'mixer' ? 'Balance channels and buses' : 'Shape your sound'}</span>
              <button type="button" onClick={() => setAssistantOpen((open) => !open)} className="rounded-lg border border-violet-400/20 px-2.5 py-1.5 text-violet-200 hover:bg-violet-500/10">{assistantOpen ? 'Hide AI' : 'Show AI'}</button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspace === 'arrangement' && <div className="flex min-h-0 flex-1"><Timeline onSelectTrack={chooseTrack} /></div>}
            {workspace === 'mixer' && <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-center justify-between border-b border-white/[.06] px-3 py-2"><div><p className="section-label">Channel mixer</p><p className="mt-0.5 text-[10px] text-slate-500">Select a channel to open its processing chain.</p></div><Button size="sm" variant="ghost" onClick={() => setTracksOpen(true)}>Manage tracks</Button></div><div className="min-h-0 flex-1 overflow-auto"><Mixer focus={effectiveFocus} onFocus={(scope, id) => setFocus({ scope, id })} /></div></div>}
            {workspace === 'processing' && <div className="flex min-h-0 flex-1 flex-col"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.06] px-3 py-2"><div className="min-w-0"><p className="section-label">Processing chain</p><p className="mt-0.5 truncate text-xs text-slate-200">{focusLabel} <span className="text-slate-500">· {processors.filter((processor) => processor.enabled).length} active / {processors.length} total</span></p></div><label className="flex items-center gap-2 text-[10px] text-slate-500">Edit channel<select aria-label="Choose channel processing chain" value={focusValue} onChange={(event) => selectFocusValue(event.target.value)} className="max-w-[210px] rounded-lg border border-white/10 bg-[#171426] px-2 py-1.5 text-xs text-slate-100"><option value="master">Master</option>{project.tracks.map((track) => <option key={track.id} value={'track:' + track.id}>{track.name}</option>)}{project.buses.map((bus) => <option key={bus.id} value={'bus:' + bus.id}>{bus.name}</option>)}</select></label></div><div className="min-h-0 flex-1 overflow-auto"><Rack scope={effectiveFocus.scope} trackId={effectiveFocus.id} processors={processors} selectedId={selectedProcessorId} onSelect={(id) => useApp.getState().selectProcessor(id)} meters={meters.gr[effectiveFocus.scope === 'master' ? 'master' : effectiveFocus.id ?? ''] ?? {}} emptyHint={effectiveFocus.scope === 'master' ? 'Add mastering processors or generate a chain from Reference Match.' : 'Add processors to this channel or load a preset.'} /></div></div>}
          </div>
        </section>

        {assistantOpen && (
          <aside className="hidden w-[330px] shrink-0 flex-col border-l border-violet-300/10 bg-[#0e0c19] xl:flex">
            <div className="flex items-center justify-between border-b border-violet-300/10 px-3 py-3">
              <div><p className="text-xs font-semibold text-white">✦ SONORA AI</p><p className="mt-0.5 text-[10px] text-slate-500">Your mixing assistant</p></div>
              <span className="flex items-center gap-1.5 text-[10px] text-lime-300"><span className="h-1.5 w-1.5 rounded-full bg-lime-300" /> Ready</span>
            </div>
            <div className="min-h-0 flex-1"><AssistantPanel /></div>
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
