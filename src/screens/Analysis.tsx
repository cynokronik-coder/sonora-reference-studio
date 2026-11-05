import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, EmptyState, HelpTip, InfoRow, Panel, Select } from '../ui/Primitives';
import { BandChart, BandBars, LoudnessChart, Waveform } from '../ui/viz';
import { formatBytes, formatTime } from '../audio/dsp/util';

export default function Analysis() {
  const { project, assets, analyses, assetBuffers, selectedAssetId, selectAsset, analyzeAsset, busy } = useApp();
  if (!project) return <div className="p-5"><Panel><EmptyState title="No project open" description="Open a project to inspect audio analysis." /></Panel></div>;
  const analysable = assets.filter((a) => a.role !== 'export');
  const asset = assets.find((a) => a.id === selectedAssetId) ?? analysable[0];
  const report = asset ? analyses[asset.id] : undefined;
  const buffer = asset ? assetBuffers[asset.id] : undefined;
  const reference = project.referenceAssetIds.map((id) => analyses[id]).find(Boolean);

  const bands = useMemo(() => report?.spectrum.bands ?? [], [report]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Measurement</p>
          <div className="mt-1 flex items-center gap-2"><h1 className="text-xl font-semibold text-ink-100">Audio analysis</h1><HelpTip title="Why analyze audio?">Analysis measures the actual uploaded file so the Reference Match engine can compare it with another song. Measurements are useful clues; they do not replace listening or musical judgement.</HelpTip></div>
          <p className="mt-1 text-xs text-ink-400">Real measurements from the decoded audio, computed in a background worker.</p>
        </div>
        <div data-tour="analysis-select" className="flex items-end gap-2">
          <Select
            label="Asset"
            value={asset?.id ?? ''}
            options={analysable.map((a) => ({ value: a.id, label: `${a.role === 'reference' ? 'REF · ' : ''}${a.name}` }))}
            onChange={(value) => selectAsset(value)}
            className="min-w-[220px]"
          />
          <Button disabled={!asset || busy?.kind === 'analyze'} onClick={() => asset && void analyzeAsset(asset.id)}>
            {report ? 'Re-analyse' : 'Analyse'}
          </Button>
        </div>
      </header>

      {!asset && <Panel><EmptyState title="No audio imported" description="Import a song to measure it." /></Panel>}

      {asset && (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Panel dataTour="analysis-report" title={asset.name} subtitle={`${formatTime(asset.duration)} · ${asset.sampleRate} Hz source · ${asset.channels} channel${asset.channels > 1 ? 's' : ''} · ${formatBytes(asset.fileSize)}`} right={<div className="flex items-center gap-2"><HelpTip title="LUFS, dBTP and crest factor">LUFS is a measure of perceived loudness. dBTP estimates the highest reconstructed peak. Crest factor compares peak level with average energy and gives a rough view of transient contrast.</HelpTip><Badge tone={report ? 'accent' : 'warn'}>{report ? 'measured' : 'not analysed'}</Badge></div>}>
            <Waveform peaks={buffer?.peaks ?? null} duration={asset.duration} position={0} height={90} faded={!report} />
            {!report && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-2xs leading-relaxed text-ink-400">No measurements yet. Analysis takes a few seconds for a full song.</p>
                <Button size="sm" variant="primary" onClick={() => void analyzeAsset(asset.id)}>Run analysis</Button>
              </div>
            )}
            {report && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Integrated" value={`${report.loudness.integratedLufs.toFixed(1)}`} unit="LUFS" />
                  <Metric label="Short-term max" value={`${report.loudness.shortTermMaxLufs.toFixed(1)}`} unit="LUFS" />
                  <Metric label="True peak" value={`${report.loudness.truePeakDb.toFixed(1)}`} unit="dBTP" />
                  <Metric label="LRA" value={`${report.loudness.lra.toFixed(1)}`} unit="LU" />
                  <Metric label="Crest" value={`${report.loudness.crestDb.toFixed(1)}`} unit="dB" />
                  <Metric label="PLR" value={`${report.loudness.plrDb.toFixed(1)}`} unit="dB" />
                  <Metric label="Width" value={`${report.stereo.widthDb.toFixed(1)}`} unit="dB" />
                  <Metric label="Correlation" value={report.stereo.correlation.toFixed(2)} unit="" />
                </div>
                <div className="mt-3">
                  <div className="section-label mb-1">Short-term loudness</div>
                  <LoudnessChart points={report.loudness.shortTerm} height={90} />
                </div>
              </>
            )}
          </Panel>

          <Panel title="File and format" subtitle="Header values when available; otherwise the browser decoder's report.">
            <InfoRow label="Role" value={asset.role} />
            <InfoRow label="Sample rate" value={`${asset.sampleRate} Hz`} />
            <InfoRow label="Bit depth" value={asset.bitDepth ? `${asset.bitDepth}-bit` : 'not in header'} />
            <InfoRow label="Channels" value={asset.channels} />
            <InfoRow label="Decoded rate" value={buffer ? `${buffer.sampleRate} Hz project` : '—'} />
            <InfoRow label="Peak" value={asset.peakDb !== null ? `${asset.peakDb.toFixed(1)} dBFS` : '—'} />
            <InfoRow label="File size" value={formatBytes(asset.fileSize)} />
            <InfoRow label="Imported" value={new Date(asset.createdAt).toLocaleString()} />
            {asset.decodedOnly && <p className="mt-2 text-2xs text-signal-amber/90">Bit depth unavailable in the container; decoding used the browser's native path.</p>}
            <p className="mt-2 text-2xs leading-relaxed text-ink-500">
              Original files are preserved byte-for-byte in local storage. Analysis and playback use a decoded working copy at
              the session rate.
            </p>
          </Panel>
        </div>
      )}

      {report && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Spectral balance" subtitle="1/3-octave band levels relative to the broadband average.">
              <BandChart bands={report.spectrum.bands.map((b) => b.relativeDb)} compare={reference?.spectrum.bands.map((b) => b.relativeDb)} label="This asset" compareLabel="Reference" height={170} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Metric label="Centroid" value={Math.round(report.spectrum.centroidHz).toString()} unit="Hz" />
                <Metric label="Roll-off 85%" value={Math.round(report.spectrum.rolloffHz).toString()} unit="Hz" />
                <Metric label="Tilt" value={report.spectrum.tiltDbPerOct.toFixed(2)} unit="dB/oct" />
                <Metric label="Flatness" value={(report.spectrum.flatness * 100).toFixed(1)} unit="%" />
              </div>
            </Panel>
            <Panel title="Stereo behaviour" subtitle="Side energy per band and mono compatibility derived from short-window correlation.">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Metric label="Width" value={`${report.stereo.widthDb.toFixed(1)}`} unit="dB" />
                <Metric label="Mono compatibility" value={report.stereo.monoCompatibility.toFixed(0)} unit="%" />
                <Metric label="L/R balance" value={`${report.stereo.balanceDb > 0 ? '+' : ''}${report.stereo.balanceDb.toFixed(1)}`} unit="dB" />
                <Metric label="Low side" value={`${report.stereo.lowSideRatioDb.toFixed(1)}`} unit="dB" />
              </div>
              <div className="space-y-0.5">
                {report.stereo.bandWidth.map((band, i) => (
                  <div key={band.center} className="flex items-center gap-2">
                    <span className="w-14 text-right font-mono text-2xs text-ink-500">{report.spectrum.bands[i]?.center ?? band.center} Hz</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-ink-800">
                      <div className="h-full bg-signal-cyan/70" style={{ width: `${Math.min(100, Math.max(0, (band.widthDb + 20) / 30 * 100))}%` }} />
                    </div>
                    <span className="w-12 font-mono text-2xs text-ink-400">{band.widthDb.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Sections" subtitle="Boundaries and labels are estimates from spectral novelty and loudness; they are not ground truth.">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-2xs">
                <thead className="text-ink-500">
                  <tr className="border-b border-ink-700">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Label</th>
                    <th className="py-1 pr-3">Start</th>
                    <th className="py-1 pr-3">End</th>
                    <th className="py-1 pr-3">LUFS</th>
                    <th className="py-1 pr-3">Crest</th>
                    <th className="py-1 pr-3">Width</th>
                    <th className="py-1 pr-3">Correlation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sections.map((section) => (
                    <tr key={section.index} className="border-b border-ink-800/70">
                      <td className="py-1 pr-3 font-mono text-ink-500">{section.index + 1}</td>
                      <td className="py-1 pr-3">
                        <Badge tone={section.label === 'chorus' ? 'accent' : 'neutral'}>{section.label}</Badge>
                      </td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{formatTime(section.start)}</td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{formatTime(section.end)}</td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{section.lufs.toFixed(1)}</td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{section.crestDb.toFixed(1)}</td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{section.widthDb.toFixed(1)}</td>
                      <td className="py-1 pr-3 font-mono text-ink-300">{section.correlation.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-2xs text-ink-500">Tempo estimate: {report.rhythm.tempoBpm || 'not detected'} BPM · confidence {Math.round(report.rhythm.beatConfidence * 100)}% · onset density {report.rhythm.onsetDensity.toFixed(2)}/s.</p>
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Resonances & buildup">
              {report.spectrum.resonances.length === 0 ? (
                <p className="text-2xs text-ink-400">No narrow resonances above the 4 dB prominence threshold.</p>
              ) : (
                <div className="space-y-1">
                  {report.spectrum.resonances.map((resonance) => (
                    <div key={resonance.frequency} className="flex items-center justify-between rounded border border-ink-700 bg-ink-850/50 px-2 py-1">
                      <span className="font-mono text-2xs text-ink-200">{resonance.frequency} Hz</span>
                      <span className="font-mono text-2xs text-signal-amber">+{resonance.excessDb.toFixed(1)} dB</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-2xs leading-relaxed text-ink-500">
                Buildup bands: {report.spectrum.buildupBands.length ? report.spectrum.buildupBands.join(', ') + ' Hz' : 'none flagged above 3 dB'}.
              </p>

            </Panel>
            <Panel title="Warnings">
              {report.warnings.length === 0 ? (
                <p className="text-2xs text-ink-400">No source problems detected.</p>
              ) : (
                <ul className="space-y-1.5">
                  {report.warnings.map((warning) => (
                    <li key={warning} className="rounded border border-signal-amber/20 bg-signal-amber/5 p-2 text-2xs leading-relaxed text-signal-amber/90">
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-2xs leading-relaxed text-ink-500">
                Measurements are deterministic and reproducible. They never depend on an AI model or an external service.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded border border-ink-700 bg-ink-850/40 px-2 py-1.5">
      <div className="text-2xs text-ink-500">{label}</div>
      <div className="font-mono text-xs text-ink-100">
        {value} <span className="text-2xs text-ink-500">{unit}</span>
      </div>
    </div>
  );
}

void BandBars;
