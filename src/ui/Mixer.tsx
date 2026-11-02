import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BusState, TrackState } from '../audio/model/types';
import { useApp } from '../state/store';
import { assistantSuggestions } from '../state/store';
import { getSonoraAiStatus, type SonoraAiStatus } from '../audio/ai/client';
import { clamp, formatTime, gainToDb } from '../audio/dsp/util';
import { Badge, Button, HelpTip, IconButton, ParamSlider, Select } from './Primitives';
import { LevelMeter, useMeters } from './viz';

export function TransportBar() {
  const { transport, togglePlay, stop, seek, setLoop, undo, redo, monitorDb, setMonitorDb, project, lastSavedAt } = useApp();
  const [loopStart, setLoopStart] = useState(transport.loopStart);
  const [loopEnd, setLoopEnd] = useState(transport.loopEnd);
  useEffect(() => setLoopStart(transport.loopStart), [transport.loopStart]);
  useEffect(() => setLoopEnd(transport.loopEnd), [transport.loopEnd]);
  const duration = transport.duration || 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-ink-700 bg-ink-900/80 px-3 py-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void togglePlay()}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-accent/50 bg-accent/15 text-accent hover:bg-accent/25"
          title={transport.playing ? 'Pause (space)' : 'Play (space)'}
        >
          {transport.playing ? '❚❚' : '▶'}
        </button>
        <IconButton title="Stop and return to start" onClick={stop}>
          ■
        </IconButton>
        <div className="ml-2 font-mono text-xs tabular-nums text-ink-100">
          {formatTime(transport.position)}
          <span className="text-ink-500"> / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton active={transport.loopEnabled} title="Toggle loop" onClick={() => setLoop(!transport.loopEnabled)}>
          loop
        </IconButton>
        <label className="flex items-center gap-1 text-2xs text-ink-500">
          in
          <input
            className="w-14 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 font-mono text-2xs text-ink-200"
            value={loopStart.toFixed(2)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setLoopStart(clamp(v, 0, loopEnd));
            }}
            onBlur={() => setLoop(transport.loopEnabled, loopStart, loopEnd)}
          />
        </label>
        <label className="flex items-center gap-1 text-2xs text-ink-500">
          out
          <input
            className="w-14 rounded border border-ink-700 bg-ink-900 px-1 py-0.5 font-mono text-2xs text-ink-200"
            value={loopEnd.toFixed(2)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setLoopEnd(clamp(v, loopStart, duration));
            }}
            onBlur={() => setLoop(transport.loopEnabled, loopStart, loopEnd)}
          />
        </label>
        <IconButton
          title="Set loop in at playhead"
          onClick={() => {
            setLoopStart(transport.position);
            setLoop(transport.loopEnabled, transport.position, loopEnd);
          }}
        >
          [in
        </IconButton>
        <IconButton
          title="Set loop out at playhead"
          onClick={() => {
            setLoopEnd(transport.position);
            setLoop(transport.loopEnabled, loopStart, transport.position);
          }}
        >
          out]
        </IconButton>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-2xs text-ink-500">monitor</span>
        <HelpTip title="Monitor level">This changes only the listening volume in your browser. It does not change track gain, the mix or the exported file.</HelpTip>
        <input
          type="range"
          min={-30}
          max={12}
          step={0.5}
          value={monitorDb}
          onChange={(e) => setMonitorDb(Number(e.target.value))}
          className="w-24"
          title="Monitor level (does not affect export)"
        />
        <span className="w-9 font-mono text-2xs text-ink-300">{monitorDb.toFixed(1)}</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconButton title="Undo (Ctrl/Cmd+Z)" onClick={undo}>
          ↶
        </IconButton>
        <IconButton title="Redo (Ctrl/Cmd+Shift+Z)" onClick={redo}>
          ↷
        </IconButton>
        <span className="ml-1 font-mono text-2xs text-ink-500">
          {lastSavedAt ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}` : project?.autosave ? 'autosave on' : 'unsaved'}
        </span>
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
    <div className="flex min-h-0 items-stretch gap-1 overflow-x-auto bg-ink-950/70 p-2">
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
      className={`flex shrink-0 cursor-pointer flex-col gap-1.5 rounded-b border border-t-2 bg-ink-850/80 p-1.5 ${
        selected ? 'border-ink-500 ring-1 ring-inset ring-accent/20' : 'border-ink-700'
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
            className={`h-4 w-4 rounded text-2xs ${track.muted ? 'bg-signal-red/30 text-signal-red' : 'bg-ink-800 text-ink-500'}`}
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
        <div className="space-y-1 border-t border-ink-700 pt-1" onClick={(e) => e.stopPropagation()}>
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
    <StripShell selected={selected} onSelect={onSelect} accent="#c8f169" width={118}>
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

export function AssistantPanel() {
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, assistantProposal, isThinking]);

  const suggestions = assistantSuggestions();
  const disabled = !project || isThinking;

  const ask = (text: string) => {
    if (!text.trim() || isThinking) return;
    void sendAssistantMessage(text.trim());
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
        <div className="min-w-0">
          <div className="section-label">Sonora AI · Mixing engineer</div>
          <div className="mt-0.5 text-2xs text-ink-500">Project-aware advice · preview-first DSP edits</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {aiStatus?.configured ? (
            <Badge tone="accent">AI online</Badge>
          ) : (
            <Badge tone="neutral">Offline mode</Badge>
          )}
          <HelpTip title="How Sonora AI works" steps={['The AI receives project metadata and measured analysis, not the raw audio file.', 'It can request local audio analysis when a report is missing.', 'It proposes real processors and parameter changes from the DSP registry.', 'Nothing is changed until you accept the proposal.']}>
            The connected model reasons about your project. If the API is not configured, Sonora uses its built-in offline command interpreter.
          </HelpTip>
          <button type="button" onClick={() => useApp.getState().toggleAssistant()} aria-label="Close assistant" className="rounded px-1.5 text-ink-500 hover:text-ink-100">×</button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {chat.length === 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-xs leading-relaxed text-ink-200">
                Tell me what you hear or what kind of result you want. I can inspect your project's measurements, explain the options and prepare editable processing changes.
              </p>
              {aiStatus?.configured ? (
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-500">Connected to {aiStatus.model}. I only receive project metadata and analysis results—not the original audio waveform.</p>
              ) : (
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-500">
                  The offline assistant is available. To enable natural-language AI, add OPENAI_API_KEY to your local .env.local file and restart the server.
                </p>
              )}
              {statusError && <p className="mt-1.5 text-2xs text-signal-amber">{statusError}</p>}
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span aria-hidden="true" className="text-accent">✦</span>
                <span className="text-2xs font-medium text-ink-200">Try asking</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Analyze my mix and tell me the three biggest issues',
                  'Make the vocals clearer without making them harsh',
                  'Help me get a tighter low end',
                  'Explain what my master loudness means',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1 text-2xs text-ink-300 transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
            {project && project.tracks.filter((t) => t.clips.length > 0 && t.kind !== 'reference').length <= 1 && (
              <p className="rounded border border-signal-amber/20 bg-signal-amber/5 p-2 text-2xs leading-relaxed text-signal-amber/90">
                This project currently has one stereo source. The assistant can process the combined mix, but it cannot independently change vocals, bass or drums without separate stems.
              </p>
            )}
          </div>
        )}

        {chat.map((message) => (
          <div
            key={message.id}
            className={`rounded-xl border p-2.5 text-xs leading-relaxed ${
              message.role === 'user'
                ? 'ml-6 border-ink-600 bg-ink-800 text-ink-100'
                : 'mr-2 border-ink-700 bg-ink-850/70 text-ink-200'
            }`}
          >
            {message.text}
            {message.detail && message.detail.length > 0 && (
              <ul className="mt-2 space-y-1.5 border-t border-ink-700 pt-2">
                {message.detail.map((line, i) => (
                  <li key={i} className="flex gap-1.5 text-2xs leading-relaxed text-ink-400">
                    <span className="text-accent/60">·</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="mr-8 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-2xs text-ink-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {busy?.label || 'Sonora AI is working…'}
          </div>
        )}

        {assistantProposal && assistantProposal.operations.length > 0 && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-2xs uppercase tracking-wider text-accent">Preview · proposed changes</span>
              <Badge tone="accent">{Math.round(assistantProposal.confidence * 100)}% confidence</Badge>
            </div>
            <p className="mb-2 text-xs text-ink-200">{assistantProposal.message}</p>
            <div className="space-y-1.5">
              {assistantProposal.operations.map((op, index) => (
                <div key={index} className="rounded-lg border border-ink-700 bg-ink-900/70 px-2 py-1.5 text-2xs leading-relaxed">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-100">{op.label || op.processorType}</span>
                    <span className="font-mono uppercase text-accent">{op.kind}</span>
                  </div>
                  <div className="mt-0.5 text-ink-400">{op.note}</div>
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
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" onClick={applyAssistantProposal}>
                Accept changes
              </Button>
              <Button size="sm" onClick={rejectAssistantProposal}>
                Reject
              </Button>
              <span className="self-center text-2xs text-ink-500">Nothing changes until accepted.</span>
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && chat.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-ink-700 px-2 py-1.5">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => ask(suggestion)}
              className="rounded-full border border-ink-700 px-2 py-0.5 text-2xs text-ink-400 hover:border-ink-500 hover:text-ink-200 disabled:opacity-40"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex gap-1.5 border-t border-ink-700 p-2"
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
          className="focus-ring min-w-0 flex-1 rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-ink-100 placeholder:text-ink-500 disabled:opacity-50"
        />
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !input.trim()}>
          {isThinking ? '…' : 'Ask'}
        </Button>
      </form>
    </div>
  );
}

