import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, InfoRow, Panel, Select, Toggle } from '../ui/Primitives';
import { getSonoraAiStatus, type SonoraAiStatus } from '../audio/ai/client';
import { realtimeHost } from '../audio/engine/realtime';

const NOT_IMPLEMENTED = [
  ['AI stem separation', 'Separating a stereo mix into vocals/drums/bass/other requires a source-separation model. Not included.'],
  ['Instrumental / vocal-only export', 'Depends on stem separation, so it is deliberately disabled rather than faked.'],
  ['Batch mastering', 'The export pipeline is single-project. A queue is not implemented.'],
  ['Collaboration, comments, sharing', 'No accounts or multi-user storage exist in this local build.'],
  ['DAW session import', 'Only WAV/AIFF/FLAC/MP3/AAC/OGG imports and individual stems are supported.'],
  ['Hardware inserts', 'Not possible in a browser engine.'],
];

export default function Settings() {
  const { project, mode, setMode, mutate, clearAllData, engineError, projects, assets, exports, analyses, saveNow } = useApp();
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
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header>
        <p className="section-label">Configuration</p>
        <h1 className="mt-1 text-xl text-ink-100">Settings</h1>
        <p className="mt-1 text-xs text-ink-400">Local-first workspace. Audio never leaves this browser unless you export it.</p>
      </header>

      <Panel title="Sonora AI assistant" right={<Badge tone={aiStatus?.configured ? 'accent' : 'neutral'}>{aiStatus?.configured ? 'connected' : 'offline fallback'}</Badge>}>
        <div className="space-y-2">
          <InfoRow label="Provider" value={aiStatus?.configured ? aiStatus.provider : 'Built-in offline assistant'} />
          <InfoRow label="Model" value={aiStatus?.configured ? aiStatus.model : 'Not configured'} />
          {aiStatusError && <p className="text-2xs text-signal-amber">{aiStatusError}</p>}
          {aiStatus?.configured ? (
            <p className="text-2xs leading-relaxed text-ink-400">
              The connected assistant can reason over project metadata and measured analysis, request local analysis when needed, and prepare validated processor changes. It never receives raw PCM audio.
            </p>
          ) : (
            <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-3 text-2xs leading-relaxed text-ink-400">
              To enable connected AI, copy <span className="font-mono text-ink-200">.env.example</span> to <span className="font-mono text-ink-200">.env.local</span>, add your key as <span className="font-mono text-ink-200">OPENAI_API_KEY</span>, and restart <span className="font-mono text-ink-200">npm run dev</span>. Keep the key on the server; never add it to a VITE variable or commit it.
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={refreshAiStatus}>Refresh AI connection</Button>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Interface">
          <div className="space-y-3">
            <div>
              <div className="section-label mb-1">Mode</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('beginner')}
                  className={`focus-ring rounded border p-2 text-left ${mode === 'beginner' ? 'border-accent/50 bg-accent/5' : 'border-ink-700'}`}
                >
                  <span className="block text-xs text-ink-100">Beginner</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">Hides advanced processor controls and keeps the signal chain legible.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('advanced')}
                  className={`focus-ring rounded border p-2 text-left ${mode === 'advanced' ? 'border-accent/50 bg-accent/5' : 'border-ink-700'}`}
                >
                  <span className="block text-xs text-ink-100">Engineer</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-ink-500">Every parameter, sidechain routing, oversampling and linear phase.</span>
                </button>
              </div>
            </div>
            {project && (
              <Toggle
                checked={project.autosave}
                onChange={(value) => mutate((next) => { next.autosave = value; })}
                label="Autosave"
                description="Project settings persist to IndexedDB shortly after every edit."
              />
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void saveNow()}>Save now</Button>
              <Badge tone="neutral">{projects.length} projects</Badge>
            </div>
          </div>
        </Panel>

        <Panel title="Audio engine">
          <InfoRow label="Realtime sample rate" value={`${realtimeHost.sampleRate} Hz`} />
          <InfoRow label="Audio context" value={realtimeHost.contextState} />
          <InfoRow label="Engine ready" value={realtimeHost.isReady ? 'yes' : 'not started'} />
          <InfoRow label="Session rate" value={project ? `${project.sampleRate} Hz` : '—'} />
          <InfoRow label="Analysis reports" value={Object.keys(analyses).length} />
          <InfoRow label="Audio assets" value={assets.length} />
          <InfoRow label="Renders" value={exports.length} />
          {engineError && (
            <div className="mt-2 rounded border border-signal-red/30 bg-signal-red/5 p-2 text-2xs leading-relaxed text-signal-red">
              Audio engine error: {engineError}
            </div>
          )}
          <p className="mt-2 text-2xs leading-relaxed text-ink-500">
            Realtime playback and offline rendering share the same TypeScript processor graph. Realtime runs in an
            AudioWorklet; export runs in a Web Worker. The browser's native Web Audio nodes are not used for processing.
          </p>
        </Panel>
      </div>

      {project && (
        <Panel title="Project">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Name</span>
              <input
                value={project.name}
                onChange={(e) => mutate((next) => { next.name = e.target.value; })}
                className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Folder</span>
              <input
                value={project.folder}
                placeholder="Ungrouped"
                onChange={(e) => mutate((next) => { next.folder = e.target.value; })}
                className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-2xs text-ink-400">Project notes</span>
              <textarea
                value={project.notes}
                rows={3}
                placeholder="Reference choices, revision notes, mix decisions…"
                onChange={(e) => mutate((next) => { next.notes = e.target.value; })}
                className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              />
            </label>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <InfoRow label="Tempo" value={`${project.tempo} BPM`} />
            <InfoRow label="Target" value={`${project.targetLufs ?? -14} LUFS / ${project.targetTruePeak ?? -1} dBTP`} />
            <InfoRow label="Master versions" value={project.masters.length} />
          </div>
        </Panel>
      )}

      <Panel title="Not implemented in this build">
        <p className="mb-2 text-2xs leading-relaxed text-ink-400">
          These modules are named in the product definition but are deliberately absent. They are listed here so the
          interface never presents them as operational.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {NOT_IMPLEMENTED.map(([title, detail]) => (
            <div key={title} className="rounded border border-ink-700 bg-ink-850/50 p-2 opacity-80">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-ink-200">{title}</span>
                <Badge tone="warn">not available</Badge>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-ink-500">{detail}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Local data">
        <p className="text-2xs leading-relaxed text-ink-400">
          Projects, original audio blobs, analyses, presets and rendered files are stored in this browser's IndexedDB.
          Clearing site data or using the button below removes them permanently. Export anything you want to keep.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {confirmClear ? (
            <>
              <Button variant="danger" onClick={() => void clearAllData()}>Yes, delete everything</Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>Delete all local data</Button>
          )}
        </div>
      </Panel>

      <Panel title="Accounts and privacy">
        <p className="text-2xs leading-relaxed text-ink-400">
          This build runs entirely in the browser and has no account system. There is no server-side user table and no
          upload of audio to a third party. Reference tracks remain as private as the device and browser profile they are
          stored on. Multi-user access control, sharing and server-side retention policies are deployment concerns that
          are documented in <span className="font-mono text-ink-200">ARCHITECTURE.md</span>, not simulated here.
        </p>
      </Panel>

      <p className="text-2xs text-ink-600">Sonora Reference Studio · local build · {new Date().getFullYear()}</p>
      {void Select}
    </div>
  );
}
