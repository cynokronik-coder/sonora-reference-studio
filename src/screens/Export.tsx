import { useState } from 'react';
import { useApp } from '../state/store';
import type { ExportSettings } from '../state/store';
import { Badge, Button, EmptyState, InfoRow, Panel, Select, Toggle } from '../ui/Primitives';
import { formatBytes } from '../audio/dsp/util';
import * as db from '../lib/db';
import { verifyEncodedBlob } from '../state/store';

export default function Export() {
  const { project, exports, exportMix, busy, lastRenderStats, downloadExport, deleteExportById, refreshExports } = useApp();
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'wav',
    bitDepth: 24,
    sampleRate: 48000,
    startSec: 0,
    endSec: 0,
    mode: 'master',
    dither: true,
    normalize: false,
    filename: '',
    metadata: { title: '', artist: '', comment: '' },
  });
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  if (!project) return <div className="p-5"><Panel><EmptyState title="No project open" description="Open a project to render and export." /></Panel></div>;

  const duration = Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  const audioTracks = project.tracks.filter((t) => t.clips.length > 0 && t.kind !== 'reference');
  const endSec = settings.endSec > 0 ? Math.min(settings.endSec, duration) : duration;
  const targetLufs = project.targetLufs ?? -14;
  const targetTp = project.targetTruePeak ?? -1;

  const verify = async (id: string) => {
    setVerifyingId(id);
    try {
      const blob = await db.getExportBlob(id);
      if (!blob) throw new Error('Export file not found.');
      const result = await verifyEncodedBlob(blob);
      useApp.getState().setToast(`Verified decoded file: ${result.lufs.toFixed(1)} LUFS · ${result.truePeakDb.toFixed(1)} dBTP.`);
    } catch (error) {
      useApp.getState().setToast(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Delivery</p>
          <h1 className="mt-1 text-xl text-ink-100">Export center</h1>
          <p className="mt-1 text-xs text-ink-400">
            Offline, deterministic rendering at the session rate or higher. The download is the encoded file itself — no
            additional lossy conversion.
          </p>
        </div>
        <Badge tone="info">{audioTracks.length} audio track{audioTracks.length === 1 ? '' : 's'}</Badge>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Render settings">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="Format"
              value={settings.format}
              options={[{ value: 'wav', label: 'WAV (PCM / float)' }, { value: 'aiff', label: 'AIFF (PCM)' }, { value: 'mp3', label: 'MP3 320 kbps' }]}
              onChange={(value) =>
                setSettings((s) => ({
                  ...s,
                  format: value,
                  bitDepth: value !== 'wav' && s.bitDepth === 32 ? 24 : s.bitDepth,
                  sampleRate: value === 'mp3' && s.sampleRate !== 44100 && s.sampleRate !== 48000 ? 48000 : s.sampleRate,
                }))
              }
            />
            <Select
              label="Bit depth"
              value={settings.bitDepth}
              options={[{ value: 16, label: '16-bit PCM' }, { value: 24, label: '24-bit PCM' }, { value: 32, label: '32-bit float (WAV only)' }]}
              onChange={(value) => setSettings((s) => ({ ...s, bitDepth: value }))}
              disabled={settings.format === 'mp3'}
            />
            <Select
              label="Sample rate"
              value={settings.sampleRate}
              options={[44100, 48000, 88200, 96000].map((rate) => ({ value: rate, label: `${rate / 1000} kHz` }))}
              onChange={(value) => setSettings((s) => ({ ...s, sampleRate: value }))}
              disabled={settings.format === 'mp3'}
            />
            {settings.format === 'mp3' && (
              <p className="text-2xs leading-relaxed text-signal-amber/90 sm:col-span-2">
                MP3 encoding is limited to 44.1/48 kHz. Choose WAV for high-resolution delivery.
              </p>
            )}
            {settings.format === 'aiff' && settings.bitDepth === 32 && (
              <p className="text-2xs leading-relaxed text-signal-amber/90 sm:col-span-2">
                AIFF supports 16/24-bit here; switch to WAV for 32-bit float.
              </p>
            )}
            <Select
              label="Render"
              value={settings.mode}
              options={[{ value: 'master', label: 'Full master (master chain)' }, { value: 'track', label: 'Single track (pre-master)' }]}
              onChange={(value) => setSettings((s) => ({ ...s, mode: value }))}
            />
            {settings.mode === 'track' && (
              <Select
                label="Track"
                value={settings.trackId ?? audioTracks[0]?.id ?? ''}
                options={audioTracks.map((track) => ({ value: track.id, label: track.name }))}
                onChange={(value) => setSettings((s) => ({ ...s, trackId: value }))}
              />
            )}
            <Select
              label="Range"
              value={endSec === duration ? 'full' : 'custom'}
              options={[{ value: 'full', label: 'Full song' }, { value: 'custom', label: 'Selected region' }]}
              onChange={(value) =>
                setSettings((s) => ({ ...s, startSec: 0, endSec: value === 'full' ? 0 : Math.min(duration, s.startSec + 30) }))
              }
            />
            {endSec !== duration && (
              <>
                <label className="block">
                  <span className="mb-1 block text-2xs text-ink-400">Start (s)</span>
                  <input type="number" step={0.1} min={0} max={endSec} value={settings.startSec} onChange={(e) => setSettings((s) => ({ ...s, startSec: Math.max(0, Number(e.target.value)) }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-2xs text-ink-400">End (s)</span>
                  <input type="number" step={0.1} min={settings.startSec} max={duration} value={endSec} onChange={(e) => setSettings((s) => ({ ...s, endSec: Math.max(s.startSec, Number(e.target.value)) }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
                </label>
              </>
            )}
          </div>

          <div className="mt-2 space-y-2">
            <Toggle checked={settings.dither} onChange={(value) => setSettings((s) => ({ ...s, dither: value }))} label="TPDF dither when reducing bit depth" description="Only applied for 16/24-bit PCM. It is never applied to 32-bit float." />
            <Toggle checked={settings.normalize} onChange={(value) => setSettings((s) => ({ ...s, normalize: value }))} label={`Normalise peak to ${targetTp.toFixed(1)} dB`} description="A final gain safety net. It does not replace the limiter and does not loudness-normalise." />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Filename</span>
              <input value={settings.filename} placeholder={project.name} onChange={(e) => setSettings((s) => ({ ...s, filename: e.target.value }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Metadata title</span>
              <input value={settings.metadata.title} placeholder={project.name} onChange={(e) => setSettings((s) => ({ ...s, metadata: { ...s.metadata, title: e.target.value } }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Artist</span>
              <input value={settings.metadata.artist} onChange={(e) => setSettings((s) => ({ ...s, metadata: { ...s.metadata, artist: e.target.value } }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-ink-400">Comment</span>
              <input value={settings.metadata.comment} onChange={(e) => setSettings((s) => ({ ...s, metadata: { ...s.metadata, comment: e.target.value } }))} className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100" />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={Boolean(busy) || (settings.mode === 'track' && !audioTracks.length)}
              onClick={() =>
                void exportMix({
                  ...settings,
                  endSec,
                  filename: settings.filename || project.name,
                  trackId: settings.trackId ?? audioTracks[0]?.id,
                })
              }
            >
              Render &amp; download
            </Button>
            <span className="text-2xs text-ink-500">
              {settings.format === 'mp3' ? 'MP3 is limited to 44.1/48 kHz and is lossy.' : settings.format === 'aiff' && settings.bitDepth === 32 ? 'AIFF does not support 32-bit float here; choose WAV.' : `${settings.format.toUpperCase()} · ${settings.sampleRate} Hz`}
            </span>
          </div>
          {busy && (
            <div className="mt-2 rounded border border-accent/20 bg-accent/5 p-2 text-2xs text-accent">
              {busy.label} · {Math.round(busy.progress * 100)}%
              {busy.cancel && (
                <button type="button" className="ml-2 underline" onClick={busy.cancel}>
                  cancel
                </button>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Targets & measured result">
          <InfoRow label="Delivery target" value={`${targetLufs.toFixed(1)} LUFS / ${targetTp.toFixed(1)} dBTP`} />
          <InfoRow label="Session rate" value={`${project.sampleRate} Hz`} />
          <InfoRow label="Render length" value={`${(endSec - settings.startSec).toFixed(1)} s`} />
          <InfoRow label="Measured LUFS" value={lastRenderStats ? lastRenderStats.lufs.toFixed(1) : 'render to measure'} />
          <InfoRow label="Measured true peak" value={lastRenderStats ? `${lastRenderStats.truePeakDb.toFixed(1)} dBTP` : '—'} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-500">
            The offline renderer measures the result before encoding. Use Verify in the history below to decode the written
            file and confirm its loudness and true peak independently of the renderer.
          </p>
        </Panel>
      </div>

      <Panel title={`Export history (${exports.length})`} right={<Button size="sm" variant="ghost" onClick={() => void refreshExports()}>Refresh</Button>}>
        {exports.length === 0 ? (
          <p className="text-2xs text-ink-500">No exports yet.</p>
        ) : (
          <div className="divide-y divide-ink-700">
            {exports.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="text-xs text-ink-100">{record.name}</div>
                  <div className="font-mono text-2xs text-ink-500">
                    {record.format} · {record.sampleRate} Hz · {record.bitDepth}-bit · {formatBytes(record.sizeBytes)} ·{' '}
                    {new Date(record.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xs text-ink-400">
                    {record.lufs !== null ? `${record.lufs.toFixed(1)} LUFS` : '—'} · {record.truePeak !== null ? `${record.truePeak.toFixed(1)} dBTP` : '—'}
                  </span>
                  <Button size="sm" onClick={() => void downloadExport(record.id)}>Download</Button>
                  <Button size="sm" variant="ghost" disabled={verifyingId === record.id} onClick={() => void verify(record.id)}>
                    {verifyingId === record.id ? 'Verifying…' : 'Verify'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteExportById(record.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Export guarantees">
        <div className="grid gap-3 text-2xs leading-relaxed text-ink-400 sm:grid-cols-3">
          <p>Rendering runs the same processor graph as monitoring, block by block, in a worker. No browser playback code path is involved.</p>
          <p>Gain reduction, limiting and clipping are deterministic. Exports do not suddenly clip or change channel count.</p>
          <p>Stem export renders one track through its own chain with the master chain bypassed. Instrumental/vocal-only renders require separated sources, which this build does not include.</p>
        </div>
      </Panel>
    </div>
  );
}
