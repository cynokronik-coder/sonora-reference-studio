import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BusState, TrackState } from '../audio/model/types';
import { useApp } from '../state/store';
import { assistantSuggestions } from '../state/store';
import { getSonoraAiStatus, type SonoraAiStatus } from '../audio/ai/client';
import { clamp, formatTime, gainToDb } from '../audio/dsp/util';
import { Badge, Button, HelpTip, IconButton, ParamSlider, Select } from './Primitives';
import { Icon } from './Icon';
import { LevelMeter, useMeters } from './viz';

export function TransportBar() {
  const { transport, togglePlay, stop, setLoop, undo, redo, monitorDb, setMonitorDb, project } = useApp();
  const [loopStart, setLoopStart] = useState(transport.loopStart);
  const [loopEnd, setLoopEnd] = useState(transport.loopEnd);
  const [toolsOpen, setToolsOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setLoopStart(transport.loopStart), [transport.loopStart]);
  useEffect(() => setLoopEnd(transport.loopEnd), [transport.loopEnd]);
  useEffect(() => {
    if (!toolsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (moreRef.current && event.target instanceof Node && !moreRef.current.contains(event.target)) setToolsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toolsOpen]);
  const duration = transport.duration || 0;

  return (
    <div className="relative z-20 flex flex-wrap items-center gap-3 border-b border-white/[.07] bg-[#0D0D1B]/92 px-4 py-3 backdrop-blur-xl sm:px-5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void togglePlay()}
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-full border border-[#A77AFF]/55 bg-gradient-to-br from-[#8957FF] to-[#7545EA] text-white shadow-violet hover:brightness-110"
          title={transport.playing ? 'Pause (space)' : 'Play (space)'}
        >
          {transport.playing ? '❚❚' : '▶'}
        </button>
        <IconButton title="Stop and return to start" onClick={stop}>■</IconButton>
        <div className="ml-2 font-mono text-sm tabular-nums text-ink-100">
          {formatTime(transport.position)}
          <span className="text-ink-500"> / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <IconButton title="Undo (Ctrl/Cmd+Z)" onClick={undo}>↶</IconButton>
        <IconButton title="Redo (Ctrl/Cmd+Shift+Z)" onClick={redo}>↷</IconButton>
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={toolsOpen}
            aria-controls="transport-more-tools"
            onClick={() => setToolsOpen((open) => !open)}
            className={`focus-ring inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-semibold transition-all ${toolsOpen ? 'border-[#A77AFF]/40 bg-[#8957FF]/[.12] text-[#C4A2FF]' : 'border-white/[.07] bg-transparent text-ink-300 hover:border-white/[.14] hover:bg-white/[.045] hover:text-white'}`}
          >
            <Icon name="sliders" size={16} /> More tools <Icon name="chevron-down" size={14} className={`transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
          </button>
          {toolsOpen && (
            <div id="transport-more-tools" role="dialog" aria-label="More playback tools" className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-24px))] rounded-2xl border border-white/[.10] bg-[#151426]/[.98] p-4 text-left shadow-floating backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink-100">More playback tools</p>
                <button type="button" onClick={() => setToolsOpen(false)} className="rounded px-1 text-ink-500 hover:text-ink-100" aria-label="Close playback tools">×</button>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs font-medium text-ink-300">Loop playback</span>
                  <IconButton active={transport.loopEnabled} title="Toggle loop" onClick={() => setLoop(!transport.loopEnabled)}> {transport.loopEnabled ? 'On' : 'Off'} </IconButton>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-2xs text-ink-500">
                    In point
                    <input
                      aria-label="Loop in point"
                      className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-xs text-ink-100"
                      value={loopStart.toFixed(2)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) setLoopStart(clamp(value, 0, loopEnd));
                      }}
                      onBlur={() => setLoop(transport.loopEnabled, loopStart, loopEnd)}
                    />
                  </label>
                  <label className="text-2xs text-ink-500">
                    Out point
                    <input
                      aria-label="Loop out point"
                      className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-xs text-ink-100"
                      value={loopEnd.toFixed(2)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) setLoopEnd(clamp(value, loopStart, duration));
                      }}
                      onBlur={() => setLoop(transport.loopEnabled, loopStart, loopEnd)}
                    />
                  </label>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => {
                    setLoopStart(transport.position);
                    setLoop(transport.loopEnabled, transport.position, loopEnd);
                  }}>Set In at Playhead</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setLoopEnd(transport.position);
                    setLoop(transport.loopEnabled, loopStart, transport.position);
                  }}>Set Out at Playhead</Button>
                </div>
              </div>
              <div className="mt-3 border-t border-ink-700 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xs font-medium text-ink-300">Monitor level</p>
                    <p className="mt-0.5 text-2xs text-ink-500">Listening volume only — does not affect the mix or export.</p>
                  </div>
                  <span className="font-mono text-2xs text-ink-200">{monitorDb.toFixed(1)} dB</span>
                </div>
                <input
                  aria-label="Monitor level"
                  type="range"
                  min={-30}
                  max={12}
                  step={0.5}
                  value={monitorDb}
                  onChange={(event) => setMonitorDb(Number(event.target.value))}
                  className="mt-3 w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Mixer({
  focus,
  onFocus,
}: {
  focus: { scope: 'master' | 'track' | 'bus'; id: string | null };
  onFocus: (scope: 'master' | 'track' | 'bus', id: string | null) => void;
}) {
  const project = useApp((s) => s.project);
  if (!project) return null;
  const audibleTracks = project.tracks.filter((t) => t.kind !== 'reference' || t.clips.length > 0);
  return (
    <div className="flex min-h-0 items-stretch gap-3 overflow-x-auto bg-[#090914] p-4 sm:p-5">
      {audibleTracks.map((track) => (
        <TrackStrip
          key={track.id}
          track={track}
          selected={focus.scope === 'track' && focus.id === track.id}
          onSelect={() => onFocus('track', track.id)}
        />
      ))}
      {project.buses.map((bus) => (
        <BusStrip key={bus.id} bus={bus} selected={focus.scope === 'bus' && focus.id === bus.id} onSelect={() => onFocus('bus', bus.id)} />
      ))}
      <MasterStrip selected={focus.scope === 'master'} onSelect={() => onFocus('master', null)} />
    </div>
  );
}

function StripShell({
  selected,
  onSelect,
  accent,
  children,
  width = 104,
}: {
  selected: boolean;
  onSelect: () => void;
  accent: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      onClick={onSelect}
      style={{ width, borderTopColor: accent }}
      className={`flex shrink-0 cursor-pointer flex-col gap-2 rounded-xl border border-t-2 bg-[#171727]/90 p-2.5 shadow-panel transition-all duration-180 ${
        selected ? 'border-[#A77AFF]/55 ring-1 ring-inset ring-[#8957FF]/20 shadow-violet-soft' : 'border-white/[.07] hover:border-white/[.12]'
      }`}
    >
      {children}
    </div>
  );
}

function TrackStrip({ track, selected, onSelect }: { track: TrackState; selected: boolean; onSelect: () => void }) {
  const project = useApp((s) => s.project)!;
  const updateTrack = useApp((s) => s.updateTrack);
  const meters = useMeters();
  const peak = meters.peaks[track.id];
  const peakDb = peak ? gainToDb(Math.max(peak.L, peak.R)) : -120;
  const [expanded, setExpanded] = useState(false);
  return (
    <StripShell selected={selected} onSelect={onSelect} accent={track.color}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-2xs uppercase tracking-wider text-ink-300">{track.kind}</span>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              updateTrack(track.id, { muted: !track.muted });
            }}
            className={`h-5 w-5 rounded-md text-[9px] ${track.muted ? 'bg-signal-red/30 text-signal-red' : 'bg-ink-800 text-ink-500'}`}
            title="Mute"
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              updateTrack(track.id, { soloed: !track.soloed });
            }}
            className={`h-4 w-4 rounded text-2xs ${track.soloed ? 'bg-signal-amber/30 text-signal-amber' : 'bg-ink-800 text-ink-500'}`}
            title="Solo"
          >
            S
          </button>
        </div>
      </div>
      <div className="truncate text-2xs text-ink-100" title={track.name}>
        {track.name}
      </div>
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={-60}
            max={12}
            step={0.5}
            value={track.volumeDb}
            onChange={(e) => updateTrack(track.id, { volumeDb: Number(e.target.value) })}
            onClick={(e) => e.stopPropagation()}
            className="w-full"
          />
          <div className="mt-0.5 flex justify-between font-mono text-2xs text-ink-500">
            <span>{track.volumeDb.toFixed(1)}</span>
            <span>{track.pan === 0 ? 'C' : track.pan > 0 ? `R${Math.round(track.pan)}` : `L${Math.round(-track.pan)}`}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={track.pan}
            onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) })}
            onClick={(e) => e.stopPropagation()}
            className="w-full"
          />
        </div>
        <LevelMeter db={peakDb} height={56} width={7} />
      </div>
      <div className="flex items-center justify-between text-2xs text-ink-500">
        <span>{track.processors.length} fx</span>
        <button type="button" className="hover:text-ink-200" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'less' : 'route'}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-white/[.07] pt-2" onClick={(e) => e.stopPropagation()}>
          <Select
            value={track.output ?? ''}
            options={[{ value: '', label: 'Master' }, ...project.buses.map((b) => ({ value: b.id, label: b.name }))]}
            onChange={(value) => updateTrack(track.id, { output: value || null })}
          />
          {project.buses.map((bus) => {
            const send = track.sends.find((s) => s.busId === bus.id);
            return (
              <div key={bus.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={Boolean(send)}
                  onChange={() => (send ? useApp.getState().removeSend(track.id, bus.id) : useApp.getState().addSend(track.id, bus.id))}
                  title={`Send to ${bus.name}`}
                />
                <span className="flex-1 truncate text-2xs text-ink-400">{bus.name}</span>
                {send && (
                  <input
                    type="number"
                    value={send.levelDb}
                    step={1}
                    onChange={(e) => useApp.getState().updateSend(track.id, bus.id, { levelDb: Number(e.target.value) })}
                    className="w-12 rounded border border-ink-700 bg-ink-900 px-1 font-mono text-2xs text-ink-200"
                  />
                )}
              </div>
            );
          })}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => updateTrack(track.id, { polarity: !track.polarity })}
              className={`flex-1 rounded border px-1 py-0.5 text-2xs ${track.polarity ? 'border-signal-amber/40 text-signal-amber' : 'border-ink-700 text-ink-500'}`}
            >
              Ø
            </button>
            <button
              type="button"
              onClick={() => updateTrack(track.id, { mono: !track.mono })}
              className={`flex-1 rounded border px-1 py-0.5 text-2xs ${track.mono ? 'border-accent/40 text-accent' : 'border-ink-700 text-ink-500'}`}
            >
              mono
            </button>
          </div>
        </div>
      )}
    </StripShell>
  );
}

function BusStrip({ bus, selected, onSelect }: { bus: BusState; selected: boolean; onSelect: () => void }) {
  const updateBus = useApp((s) => s.updateBus);
  const meters = useMeters();
  const peak = meters.peaks[bus.id];
  return (
    <StripShell selected={selected} onSelect={onSelect} accent={bus.color} width={92}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs uppercase tracking-wider text-signal-cyan">bus</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateBus(bus.id, { muted: !bus.muted });
          }}
          className={`h-4 w-4 rounded text-2xs ${bus.muted ? 'bg-signal-red/30 text-signal-red' : 'bg-ink-800 text-ink-500'}`}
        >
          M
        </button>
      </div>
      <div className="truncate text-2xs text-ink-100" title={bus.name}>{bus.name}</div>
      <div className="flex items-end gap-1">
        <input
          type="range"
          min={-60}
          max={12}
          step={0.5}
          value={bus.volumeDb}
          onChange={(e) => updateBus(bus.id, { volumeDb: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="w-full"
        />
        <LevelMeter db={peak ? gainToDb(Math.max(peak.L, peak.R)) : -120} height={56} width={7} />
      </div>
      <div className="font-mono text-2xs text-ink-500">{bus.volumeDb.toFixed(1)} dB</div>
      <div className="text-2xs text-ink-500">{bus.processors.length} fx</div>
    </StripShell>
  );
}

function MasterStrip({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const project = useApp((s) => s.project)!;
  const setMasterVolume = useApp((s) => s.setMasterVolume);
  const meters = useMeters();
  const master = meters.peaks.master;
  return (
    <StripShell selected={selected} onSelect={onSelect} accent="#8EDB75" width={118}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs uppercase tracking-wider text-accent">master</span>
        <span className="font-mono text-2xs text-ink-500">{project.master.processors.length} fx</span>
      </div>
      <div className="text-2xs text-ink-100">Sum</div>
      <div className="flex items-end gap-1">
        <input
          type="range"
          min={-24}
          max={6}
          step={0.1}
          value={project.master.volumeDb}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-full"
        />
        <LevelMeter db={master ? gainToDb(Math.max(master.L, master.R)) : meters.peakL} height={64} width={9} peakDb={meters.peakL} />
      </div>
      <div className="font-mono text-2xs text-ink-400">{project.master.volumeDb.toFixed(1)} dB</div>
      <div className="text-2xs text-ink-500">{meters.peakL > -60 ? `${meters.peakL.toFixed(1)} dB` : 'silent'}</div>
    </StripShell>
  );
}

export function AssistantPanel({ onClose, onExpand }: { onClose?: () => void; onExpand?: () => void } = {}) {
  const {
    project,
    chat,
    assistantProposal,
    assistantScope,
    setAssistantScope,
    sendAssistantMessage,
    applyAssistantProposal,
    rejectAssistantProposal,
    selectedTrackId,
    busy,
  } = useApp();
  const [input, setInput] = useState('');
  const [aiStatus, setAiStatus] = useState<SonoraAiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const track = project?.tracks.find((t) => t.id === selectedTrackId);
  const isThinking = busy?.kind === 'assistant' || busy?.kind === 'analyze';

  useEffect(() => {
    let active = true;
    void getSonoraAiStatus()
      .then((status) => {
        if (active) {
          setAiStatus(status);
          setStatusError(null);
        }
      })
      .catch((error) => {
        if (active) setStatusError(error instanceof Error ? error.message : 'AI server is not reachable.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [chat.length, assistantProposal, isThinking]);

  const suggestions = assistantSuggestions();
  const disabled = !project || isThinking;

  const ask = (text: string) => {
    if (!text.trim() || isThinking) return;
    void sendAssistantMessage(text.trim());
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
      <div data-assistant-drag-handle className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-white/[.07] px-4 py-3 xl:cursor-grab xl:touch-none xl:select-none xl:active:cursor-grabbing sm:flex-nowrap sm:items-center sm:px-5 sm:py-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-[-.02em] text-ink-100 sm:text-lg">
            <span aria-hidden="true" className="hidden text-xs tracking-[-.2em] text-ink-500 xl:inline">⠿</span>
            <Icon name="sparkles" size={15} className="shrink-0 text-[#A77AFF]" />
            <span className="truncate">Sonora AI</span>
          </div>
          <div className="mt-1 break-words text-[11px] leading-4 text-ink-400 sm:text-xs">Mixing copilot · changes are always previewed first</div>
          {track && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-white/[.08] bg-black/20 p-0.5">
              <button type="button" aria-pressed={assistantScope === 'master'} onClick={() => setAssistantScope('master')} className={`rounded-md px-2 py-1 text-[9px] font-medium transition-colors ${assistantScope === 'master' ? 'bg-[#8957FF]/20 text-[#C4A2FF]' : 'text-ink-500 hover:text-ink-200'}`}>Full mix</button>
              <button type="button" aria-pressed={assistantScope === 'track'} onClick={() => setAssistantScope('track')} className={`max-w-[130px] truncate rounded-md px-2 py-1 text-[9px] font-medium transition-colors ${assistantScope === 'track' ? 'bg-[#8957FF]/20 text-[#C4A2FF]' : 'text-ink-500 hover:text-ink-200'}`}>Selected track</button>
            </div>
          )}
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-1 sm:w-auto sm:shrink-0">
          {aiStatus?.configured ? (
            <Badge tone="accent">AI online</Badge>
          ) : (
            <Badge tone="neutral">Offline mode</Badge>
          )}
          <HelpTip title="How Sonora AI works" steps={['The AI receives project metadata and measured analysis, not the raw audio file.', 'It can request local audio analysis when a report is missing.', 'It proposes real processors and parameter changes from the DSP registry.', 'Nothing is changed until you accept the proposal.']}>
            The connected model reasons about your project. If the API is not configured, Sonora uses its built-in offline command interpreter.
          </HelpTip>
          {onExpand && <button type="button" onClick={onExpand} title="Open AI Assistant full screen" aria-label="Open AI Assistant full screen" className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#A77AFF]/25 bg-[#8957FF]/[.08] px-2.5 text-xs font-semibold text-[#C4A2FF] transition-colors hover:bg-[#8957FF]/15">⤢ <span className="hidden md:inline">Full screen</span></button>}
          <button type="button" onClick={() => { if (onClose) onClose(); else useApp.getState().toggleAssistant(); }} aria-label="Close assistant" className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base text-ink-500 transition-colors hover:bg-white/[.05] hover:text-ink-100">×</button>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
        }}
        className="mx-auto flex min-h-0 w-full max-w-[1440px] min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 py-5 sm:gap-5 sm:px-5 sm:py-6"
      >
        {chat.length === 0 && (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-5 py-3">
            <div className="rounded-2xl border border-[#A77AFF]/20 bg-[radial-gradient(ellipse_at_top_right,rgba(137,87,255,.14),transparent_48%),#11111F] p-5 sm:p-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#A77AFF]/25 bg-[#8957FF]/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-[#C4A2FF]">
                <Icon name="sparkles" size={12} /> Studio copilot
              </div>
              <h2 className="text-lg font-semibold tracking-[-.02em] text-white sm:text-xl">What would you like to improve?</h2>
              <p className="mt-2 max-w-2xl text-xs leading-6 text-ink-300 sm:text-sm">
                Ask about your mix, get a focused analysis, or prepare processing changes. Sonora explains each suggestion before anything is applied.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-ink-500">
                <span className="rounded-lg border border-white/[.08] bg-black/20 px-2.5 py-1.5">{assistantScope === 'track' && track ? track.name : 'Full mix context'}</span>
                <span className="rounded-lg border border-white/[.08] bg-black/20 px-2.5 py-1.5">{aiStatus?.configured ? aiStatus.model : 'Offline command mode'}</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink-400">Start with a task</p>
                <span className="text-[10px] text-ink-600">Choose one to begin</span>
              </div>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                {[
                  ['Mix diagnosis', 'Analyze my mix and tell me the three biggest issues'],
                  ['Vocal clarity', 'Make the vocals clearer without making them harsh'],
                  ['Low-end control', 'Help me get a tighter low end'],
                  ['Mastering basics', 'Explain what my master loudness means'],
                ].map(([label, suggestion]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="group flex min-w-0 items-start gap-3 rounded-xl border border-white/[.08] bg-[#171727]/75 px-3.5 py-3 text-left transition-colors hover:border-[#A77AFF]/35 hover:bg-[#8957FF]/[.08]"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#A77AFF]/20 bg-[#8957FF]/10 text-[#C4A2FF]"><Icon name="sparkles" size={13} /></span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-ink-100">{label}</span>
                      <span className="mt-1 block break-words text-[11px] leading-5 text-ink-400">{suggestion}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {!aiStatus?.configured && (
              <div className="rounded-xl border border-white/[.07] bg-[#11111F]/80 px-3.5 py-3 text-[11px] leading-5 text-ink-400">
                Sonora is currently using its offline command interpreter. Configure the server-side AI key in your Render service environment to enable connected natural-language responses.
                {statusError && <p className="mt-1 break-words text-signal-amber">{statusError}</p>}
              </div>
            )}
            {project && project.tracks.filter((t) => t.clips.length > 0 && t.kind !== 'reference').length <= 1 && (
              <p className="rounded-xl border border-signal-amber/20 bg-signal-amber/5 p-3 text-[11px] leading-5 text-signal-amber/90">
                This project has one stereo source. Sonora can process the combined mix, but separate vocal, bass and drum controls require individual stems.
              </p>
            )}
          </div>
        )}

        {chat.map((message) => (
          <div key={message.id} className={`flex w-full min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <article className={`min-w-0 max-w-[94%] rounded-2xl border p-3 sm:p-4 ${
              message.role === 'user'
                ? 'max-w-[88%] border-[#A77AFF]/25 bg-[#8957FF]/[.13] text-ink-100'
                : 'w-full border-white/[.07] bg-[#171727]/85 text-ink-200'
            }`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold ${message.role === 'user' ? 'bg-[#8957FF]/25 text-[#D8C6FF]' : 'border border-[#A77AFF]/20 bg-[#8957FF]/10 text-[#C4A2FF]'}`}>
                  {message.role === 'user' ? 'Y' : <Icon name="sparkles" size={12} />}
                </span>
                <span className="text-[10px] font-semibold text-ink-300">{message.role === 'user' ? 'You' : 'Sonora AI'}</span>
              </div>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-6 sm:text-sm sm:leading-7">{message.text}</p>
              {message.detail && message.detail.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-white/[.07] pt-3">
                  {message.detail.map((line, i) => (
                    <li key={i} className="flex min-w-0 gap-2 break-words text-[11px] leading-5 text-ink-300 sm:text-xs">
                      <span className="text-accent/60">·</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        ))}

        {isThinking && (
          <div className="mr-0 flex min-w-0 max-w-full items-start gap-3 break-words rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3 text-xs text-ink-200 sm:mr-8 sm:items-center sm:px-5 sm:py-4 sm:text-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {busy?.label || 'Sonora AI is working…'}
          </div>
        )}

        {assistantProposal && assistantProposal.operations.length > 0 && (
          <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] rounded-2xl border border-[#A77AFF]/30 bg-[#8957FF]/[.08] p-4 shadow-violet-soft sm:p-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-accent">Preview · proposed changes</span>
              <Badge tone="accent">{Math.round(assistantProposal.confidence * 100)}% confidence</Badge>
            </div>
            <p className="mb-4 break-words text-sm leading-6 text-ink-100 sm:text-base">{assistantProposal.message}</p>
            <div className="space-y-1.5">
              {assistantProposal.operations.map((op, index) => (
                <div key={index} className="min-w-0 rounded-xl border border-white/[.07] bg-[#0D0D1B]/80 px-3 py-3 text-xs leading-6 sm:px-4 sm:text-sm">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
                    <span className="min-w-0 break-words font-medium text-ink-100">{op.label || op.processorType}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-accent">{op.kind}</span>
                  </div>
                  <div className="mt-1 break-words text-ink-300">{op.note}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-ink-600">{op.scope}{op.trackId ? ` · ${op.trackId}` : ''}</div>
                </div>
              ))}
            </div>
            {assistantProposal.explanation.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-ink-700 pt-2">
                {assistantProposal.explanation.map((line, index) => (
                  <li key={index} className="text-2xs leading-relaxed text-ink-400">• {line}</li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Button size="md" variant="primary" onClick={applyAssistantProposal}>
                Accept changes
              </Button>
              <Button size="md" onClick={rejectAssistantProposal}>
                Reject
              </Button>
              <span className="self-center text-xs text-ink-400 sm:text-sm">Nothing changes until accepted.</span>
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && chat.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2 border-t border-ink-700 px-4 py-3 sm:px-6 sm:py-4">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => ask(suggestion)}
              className="max-w-full rounded-full border border-ink-700 px-3 py-2 text-left text-xs leading-5 text-ink-300 hover:border-ink-500 hover:text-ink-200 disabled:opacity-40 sm:px-4 sm:text-sm"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex min-w-0 flex-col gap-2 border-t border-white/[.07] bg-[#0D0D1B]/90 p-3 sm:flex-row sm:gap-3 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          ask(input);
          setInput('');
        }}
      >
        <input
          value={input}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          placeholder={disabled ? 'Open a project to use Sonora AI' : 'Describe what you hear or want to improve…'}
          className="focus-ring min-h-[50px] w-full min-w-0 flex-1 rounded-xl border border-white/[.12] bg-[#090914] px-4 py-3 text-sm text-ink-100 placeholder:text-xs placeholder:text-ink-500 disabled:opacity-50 sm:min-h-[54px] sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
        />
        <Button type="submit" variant="primary" size="md" className="w-full shrink-0 sm:w-auto" disabled={disabled || !input.trim()}>
          {isThinking ? '…' : 'Ask'}
        </Button>
      </form>
    </div>
  );
}

