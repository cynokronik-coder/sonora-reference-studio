import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BusState, TrackState } from '../audio/model/types';
import { useApp } from '../state/store';
import { assistantSuggestions } from '../state/store';
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
  } = useApp();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const track = project?.tracks.find((t) => t.id === selectedTrackId);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, assistantProposal]);
  const suggestions = assistantSuggestions();
  const disabled = !project;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
        <div>
          <div className="section-label">Mixing assistant</div>
          <div className="mt-0.5 text-2xs text-ink-500">Natural language → previewable chain edits</div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAssistantScope('master')}
            className={`rounded border px-1.5 py-0.5 text-2xs ${assistantScope === 'master' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-ink-700 text-ink-500'}`}
          >
            master
          </button>
          <button
            type="button"
            disabled={!track}
            onClick={() => setAssistantScope('track')}
            className={`rounded border px-1.5 py-0.5 text-2xs disabled:opacity-40 ${assistantScope === 'track' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-ink-700 text-ink-500'}`}
          >
            {track ? track.name.slice(0, 10) : 'track'}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {chat.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-ink-300">
              Ask for a sound in plain language. I will show you the proposed processors and every value before anything
              changes.
            </p>
            <p className="text-2xs leading-relaxed text-ink-500">
              Requests are interpreted by a deterministic intent engine that reads the current chain. No external AI key is
              required, and I never invent measurements.
            </p>
            {project && project.tracks.filter((t) => t.clips.length > 0 && t.kind !== 'reference').length <= 1 && (
              <p className="rounded border border-signal-amber/20 bg-signal-amber/5 p-2 text-2xs leading-relaxed text-signal-amber/90">
                Stereo project: the assistant can only shape the combined mix. Independent vocal or drum processing needs
                separate stems.
              </p>
            )}
          </div>
        )}
        {chat.map((message) => (
          <div
            key={message.id}
            className={`rounded border p-2 text-xs leading-relaxed ${
              message.role === 'user'
                ? 'ml-6 border-ink-600 bg-ink-800 text-ink-100'
                : 'mr-2 border-ink-700 bg-ink-850/70 text-ink-200'
            }`}
          >
            {message.text}
            {message.detail && message.detail.length > 0 && (
              <ul className="mt-1.5 space-y-1 border-t border-ink-700 pt-1.5">
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

        {assistantProposal && assistantProposal.operations.length > 0 && (
          <div className="rounded border border-accent/30 bg-accent/5 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-2xs uppercase tracking-wider text-accent">proposed changes</span>
              <Badge tone="accent">{Math.round(assistantProposal.confidence * 100)}%</Badge>
            </div>
            <div className="space-y-1">
              {assistantProposal.operations.map((op, index) => (
                <div key={index} className="rounded bg-ink-900/60 px-1.5 py-1 text-2xs leading-relaxed text-ink-300">
                  <span className="mr-1 font-mono text-accent/80">{op.kind}</span>
                  {op.processorType}
                  <span className="ml-1 text-ink-500">{op.note}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" variant="primary" onClick={applyAssistantProposal}>
                Accept changes
              </Button>
              <Button size="sm" onClick={rejectAssistantProposal}>
                Reject
              </Button>
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-ink-700 px-2 py-1.5">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => sendAssistantMessage(suggestion)}
              className="rounded-full border border-ink-700 px-2 py-0.5 text-2xs text-ink-400 hover:border-ink-500 hover:text-ink-200"
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
          sendAssistantMessage(input.trim());
          setInput('');
        }}
      >
        <input
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? 'Open a project to use the assistant' : 'Make the vocals clearer without harshness…'}
          className="focus-ring min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 disabled:opacity-50"
        />
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !input.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}

export function ParamRackMini({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return <ParamSlider label={label} value={value} min={min} max={max} unit={unit} onChange={onChange} compact />;
}
