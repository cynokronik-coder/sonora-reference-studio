import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, EmptyState, InfoRow, Panel, Tabs, Toggle } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { getSonoraAiStatus, type SonoraAiStatus } from '../audio/ai/client';
import { realtimeHost } from '../audio/engine/realtime';

type SettingsSection = 'ai' | 'interface' | 'audio' | 'project' | 'storage' | 'about';

const NOT_IMPLEMENTED = [
  ['AI stem separation', 'Separating a stereo mix into vocals/drums/bass/other requires a source-separation model. Not included.'],
  ['Instrumental / vocal-only export', 'Depends on stem separation, so it is deliberately disabled rather than faked.'],
  ['Batch mastering', 'The export pipeline is single-project. A queue is not implemented.'],
  ['Collaboration, comments, sharing', 'No accounts or multi-user storage exist in this local build.'],
  ['DAW session import', 'Only WAV/AIFF/FLAC/MP3/AAC/OGG imports and individual stems are supported.'],
  ['Hardware inserts', 'Not possible in a browser engine.'],
];

export default function Settings() {
  const {
    project,
    mode,
    setMode,
    mutate,
    clearAllData,
    engineError,
    storageError,
    projects,
    assets,
    exports,
    analyses,
    saveNow,
  } = useApp();
  const [section, setSection] = useState<SettingsSection>('ai');
  const [confirmClear, setConfirmClear] = useState(false);
  const [aiStatus, setAiStatus] = useState<SonoraAiStatus | null>(null);
  const [aiStatusError, setAiStatusError] = useState<string | null>(null);

  const refreshAiStatus = () => {
    void getSonoraAiStatus()
      .then((status) => { setAiStatus(status); setAiStatusError(null); })
      .catch((error) => setAiStatusError(error instanceof Error ? error.message : 'AI server unavailable.'));
  };

  useEffect(() => {
    refreshAiStatus();
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-5">
      <header className="border-b border-white/[.06] pb-4">
        <p className="section-label">Configuration</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-[-.025em] text-white">Settings</h1>
            <p className="mt-1 text-xs text-ink-400">Configure your workspace, audio engine and connected services.</p>
          </div>
          <Badge tone="neutral">Local-first workspace</Badge>
        </div>
      </header>

      <Tabs
        value={section}
        onChange={setSection}
        tabs={[
          { value: 'ai', label: 'AI assistant' },
          { value: 'interface', label: 'Interface' },
          { value: 'audio', label: 'Audio' },
          { value: 'project', label: 'Project' },
          { value: 'storage', label: 'Storage & privacy' },
          { value: 'about', label: 'About' },
        ]}
      />

      {section === 'ai' && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="Sonora AI assistant" subtitle="Connection status and safe processing workflow." right={<Badge tone={aiStatus?.configured ? 'accent' : 'neutral'}>{aiStatus?.configured ? 'Connected' : 'Offline fallback'}</Badge>}>
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-white/[.07] bg-[#0D0D1B]/70 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-ink-500">Provider</p>
                  <p className="mt-1 text-xs font-medium text-ink-100">{aiStatus?.configured ? aiStatus.provider : 'Built-in offline assistant'}</p>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-[#0D0D1B]/70 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-ink-500">Model</p>
                  <p className="mt-1 text-xs font-medium text-ink-100">{aiStatus?.configured ? aiStatus.model : 'Not configured'}</p>
                </div>
              </div>
              {aiStatusError && <p className="rounded-lg border border-signal-amber/20 bg-signal-amber/5 p-2.5 text-2xs text-signal-amber">{aiStatusError}</p>}
              {aiStatus?.configured ? (
                <p className="text-xs leading-relaxed text-ink-400">
                  The connected assistant reasons over project metadata and measured analysis. It can request local analysis and prepare validated processor changes, but it never receives raw PCM audio.
                </p>
              ) : (
                <div className="rounded-xl border border-white/[.07] bg-[#0D0D1B]/70 p-3 text-xs leading-relaxed text-ink-400">
                  To enable connected AI, copy <span className="font-mono text-ink-200">.env.example</span> to <span className="font-mono text-ink-200">.env.local</span>, add your key as <span className="font-mono text-ink-200">OPENAI_API_KEY</span>, and restart <span className="font-mono text-ink-200">npm run dev</span>. Keep the key on the server; never add it to a VITE variable or commit it.
                </div>
              )}
              <Button size="sm" variant="secondary" onClick={refreshAiStatus}>
                <Icon name="activity" size={14} /> Refresh connection
              </Button>
            </div>
          </Panel>

          <Panel title="Approval and privacy" subtitle="AI suggestions remain under your control.">
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Icon name="check" size={16} className="mt-0.5 text-signal-green" />
                <div><p className="text-xs font-medium text-ink-100">Preview before applying</p><p className="mt-0.5 text-2xs leading-relaxed text-ink-500">Processor changes require your explicit approval.</p></div>
              </div>
              <div className="flex items-start gap-2">
                <Icon name="check" size={16} className="mt-0.5 text-signal-green" />
                <div><p className="text-xs font-medium text-ink-100">No raw audio sent to the model</p><p className="mt-0.5 text-2xs leading-relaxed text-ink-500">The connected assistant receives metadata and measured summaries, not PCM samples.</p></div>
              </div>
              <div className="flex items-start gap-2">
                <Icon name="check" size={16} className="mt-0.5 text-signal-green" />
                <div><p className="text-xs font-medium text-ink-100">Offline fallback</p><p className="mt-0.5 text-2xs leading-relaxed text-ink-500">The built-in command assistant remains available without an API connection.</p></div>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {section === 'interface' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Interface mode" subtitle="Choose how much technical detail Sonora displays.">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('beginner')}
                aria-pressed={mode === 'beginner'}
                className={`focus-ring rounded-xl border p-3 text-left transition-all duration-180 ${mode === 'beginner' ? 'border-[#A77AFF]/45 bg-[#8957FF]/[.10] shadow-violet-soft' : 'border-white/[.07] bg-[#0D0D1B]/65 hover:border-white/[.14]'}`}
              >
                <span className="block text-xs font-semibold text-ink-100">Beginner</span>
                <span className="mt-1 block text-2xs leading-relaxed text-ink-500">Hides advanced processor controls and keeps the signal chain legible.</span>
                {mode === 'beginner' && <Badge tone="accent" className="mt-3">Active</Badge>}
              </button>
              <button
                type="button"
                onClick={() => setMode('advanced')}
                aria-pressed={mode === 'advanced'}
                className={`focus-ring rounded-xl border p-3 text-left transition-all duration-180 ${mode === 'advanced' ? 'border-[#A77AFF]/45 bg-[#8957FF]/[.10] shadow-violet-soft' : 'border-white/[.07] bg-[#0D0D1B]/65 hover:border-white/[.14]'}`}
              >
                <span className="block text-xs font-semibold text-ink-100">Engineer</span>
                <span className="mt-1 block text-2xs leading-relaxed text-ink-500">Every parameter, sidechain routing, oversampling and linear phase.</span>
                {mode === 'advanced' && <Badge tone="accent" className="mt-3">Active</Badge>}
              </button>
            </div>
          </Panel>
          <Panel title="Visual preferences" subtitle="Current interface design system.">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-[#0D0D1B]/65 p-3">
              <div><p className="text-xs font-medium text-ink-100">Appearance</p><p className="mt-0.5 text-2xs text-ink-500">Sonora dark · navy and violet</p></div>
              <Badge tone="accent">Dark</Badge>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {['#090914','#171727','#7545EA','#8957FF','#8EDB75'].map((color) => <span key={color} className="h-8 rounded-lg border border-white/[.10]" style={{ backgroundColor: color }} title={color} />)}
            </div>
            <p className="mt-2 text-2xs text-ink-500">Theme customization is not exposed in this build; these colors are the shared Sonora design tokens.</p>
          </Panel>
          {project && (
            <Panel title="Autosave" subtitle="Keep project edits persisted locally.">
              <Toggle checked={project.autosave} onChange={(value) => mutate((next) => { next.autosave = value; })} label="Autosave" description="Project settings persist to IndexedDB shortly after every edit." />
              <div className="mt-3 flex items-center gap-2"><Button size="sm" onClick={() => void saveNow()}>Save now</Button><Badge tone="neutral">{projects.length} projects</Badge></div>
            </Panel>
          )}
        </div>
      )}

      {section === 'audio' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Panel title="Audio engine" subtitle="Live engine and session information.">
            <div className="grid gap-1 sm:grid-cols-2">
              <InfoRow label="Realtime sample rate" value={`${realtimeHost.sampleRate} Hz`} />
              <InfoRow label="Audio context" value={realtimeHost.contextState} />
              <InfoRow label="Engine ready" value={realtimeHost.isReady ? 'yes' : 'not started'} />
              <InfoRow label="Session rate" value={project ? `${project.sampleRate} Hz` : '—'} />
              <InfoRow label="Analysis reports" value={Object.keys(analyses).length} />
              <InfoRow label="Audio assets" value={assets.length} />
              <InfoRow label="Renders" value={exports.length} />
            </div>
            {engineError && <div className="mt-3 rounded-xl border border-signal-red/25 bg-signal-red/5 p-3 text-2xs leading-relaxed text-signal-red">Audio engine error: {engineError}</div>}
          </Panel>
          <Panel title="Signal path" subtitle="How Sonora processes audio.">
            <p className="text-xs leading-relaxed text-ink-400">Realtime playback and offline rendering share the same TypeScript processor graph. Realtime runs in an AudioWorklet; export runs in a Web Worker. Browser-native Web Audio nodes are not used for the core processing graph.</p>
          </Panel>
        </div>
      )}

      {section === 'project' && (
        project ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <Panel title="Project details" subtitle="Edit the active session information.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-2xs font-medium text-ink-400">Name</span>
                  <input value={project.name} onChange={(event) => mutate((next) => { next.name = event.target.value; })} className="focus-ring w-full rounded-control border border-white/[.09] bg-[#0D0D1B] px-3 py-2 text-xs text-ink-100" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-2xs font-medium text-ink-400">Folder</span>
                  <input value={project.folder} placeholder="Ungrouped" onChange={(event) => mutate((next) => { next.folder = event.target.value; })} className="focus-ring w-full rounded-control border border-white/[.09] bg-[#0D0D1B] px-3 py-2 text-xs text-ink-100" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-2xs font-medium text-ink-400">Project notes</span>
                  <textarea value={project.notes} rows={4} placeholder="Reference choices, revision notes, mix decisions…" onChange={(event) => mutate((next) => { next.notes = event.target.value; })} className="focus-ring w-full rounded-control border border-white/[.09] bg-[#0D0D1B] px-3 py-2 text-xs text-ink-100" />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2"><Button size="sm" onClick={() => void saveNow()}>Save project</Button><Badge tone="neutral">{project.tracks.length} tracks</Badge></div>
            </Panel>
            <Panel title="Session summary">
              <InfoRow label="Tempo" value={`${project.tempo} BPM`} />
              <InfoRow label="Target" value={`${project.targetLufs ?? -14} LUFS / ${project.targetTruePeak ?? -1} dBTP`} />
              <InfoRow label="Master versions" value={project.masters.length} />
              <InfoRow label="Sample rate" value={`${project.sampleRate.toLocaleString()} Hz`} />
            </Panel>
          </div>
        ) : <Panel><EmptyState title="No project open" description="Open a project to edit its settings." /></Panel>
      )}

      {section === 'storage' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Local data" subtitle="Projects and audio are stored in this browser profile.">
            <p className="text-xs leading-relaxed text-ink-400">Projects, original audio blobs, analyses, presets and rendered files are stored in this browser's IndexedDB. Clearing site data or using the button below removes them permanently. Export anything you want to keep.</p>
            {storageError && <p className="mt-3 rounded-lg border border-signal-amber/20 bg-signal-amber/5 p-2 text-2xs text-signal-amber">{storageError}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {confirmClear ? (
                <>
                  <Button variant="danger" onClick={() => void clearAllData()}>Yes, delete everything</Button>
                  <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                </>
              ) : <Button variant="danger" onClick={() => setConfirmClear(true)}>Delete all local data</Button>}
            </div>
          </Panel>
          <Panel title="Accounts and privacy" subtitle="This build runs locally; multi-user access is not implemented.">
            <p className="text-xs leading-relaxed text-ink-400">There is no account system or server-side user table in this local build. Reference tracks remain stored in the current browser profile. Multi-user access control, sharing and server-side retention policies are deployment concerns, not simulated features.</p>
            <div className="mt-3 flex items-center gap-2"><Icon name="shield-check" size={16} className="text-signal-green" /><span className="text-2xs text-ink-400">Original audio remains local unless you explicitly export it or configure a connected service.</span></div>
          </Panel>
        </div>
      )}

      {section === 'about' && (
        <div className="space-y-3">
          <Panel title="Feature availability" subtitle="Capabilities that are deliberately not presented as operational.">
            <p className="mb-3 text-xs leading-relaxed text-ink-400">These modules are part of the broader product direction but are not included in this build.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {NOT_IMPLEMENTED.map(([title, detail]) => (
                <div key={title} className="rounded-xl border border-white/[.07] bg-[#0D0D1B]/65 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-ink-200">{title}</span><Badge tone="warn">Unavailable</Badge></div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-ink-500">{detail}</p>
                </div>
              ))}
            </div>
          </Panel>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-[#11111F]/75 px-4 py-3">
            <div><p className="text-xs font-medium text-ink-200">Sonora Reference Studio</p><p className="mt-0.5 text-2xs text-ink-500">Local build · {new Date().getFullYear()}</p></div>
            <Badge tone="neutral">v0.1</Badge>
          </div>
        </div>
      )}
    </div>
  );
}
