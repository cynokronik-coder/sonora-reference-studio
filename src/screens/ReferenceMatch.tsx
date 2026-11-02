import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, HelpTip, InfoRow, Panel, ParamSlider, Select, Toggle, useFilePicker } from '../ui/Primitives';
import { BandChart, BandBars, Waveform } from '../ui/viz';
import { MATCH_CATEGORIES, type CategorySource } from '../audio/analysis/match';
import type { MatchSettings } from '../audio/model/types';
import { formatTime } from '../audio/dsp/util';

export default function ReferenceMatch() {
  const {
    project,
    assets,
    analyses,
    matchPlan,
    importFiles,
    analyzeProjectAssets,
    removeReference,
    updateMatchSettings,
    generateMatch,
    applyMatchPlan,
    verifyMaster,
    lastRenderStats,
    busy,
    updateTrack,
  } = useApp();
  const picker = useFilePicker();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const targetId = project?.targetAssetIds[0];
  const targetMeta = assets.find((a) => a.id === targetId);
  const targetReport = targetId ? analyses[targetId] : undefined;
  const referenceIds = project?.referenceAssetIds ?? [];
  const references = referenceIds.map((id) => ({
    id,
    meta: assets.find((a) => a.id === id),
    report: analyses[id],
    track: project?.tracks.find((t) => t.kind === 'reference' && t.clips.some((c) => c.assetId === id)),
  }));
  const analysedRefs = references.filter((r) => r.report);
  const referenceReport = analysedRefs[0]?.report;

  useEffect(() => {
    if (matchPlan) setExcluded(new Set());
  }, [matchPlan]);

  const preview = useMemo(() => {
    if (!targetReport || !referenceReport) return null;
    const before = targetReport.spectrum.bands.map((b) => b.relativeDb);
    const after = before.map((value, i) => {
      const diff = (referenceReport.spectrum.bands[i]?.relativeDb ?? value) - value;
      const scale = Math.pow((project?.match.intensity ?? 0) / 100, 1.25) * ((project?.match.frequencyBalance ?? 0) / 100);
      return value + diff * scale;
    });
    return { before, after };
  }, [targetReport, referenceReport, project?.match.intensity, project?.match.frequencyBalance]);

  if (!project) {
    return <div className="p-5"><Panel><EmptyState title="No project open" description="Open a project to start a reference match." /></Panel></div>;
  }

  const setMatch = (patch: Partial<MatchSettings>) => updateMatchSettings(patch);
  const ready = Boolean(targetReport) && analysedRefs.length > 0;

  const comparison = targetReport && referenceReport
    ? [
        { label: 'Integrated loudness', target: `${targetReport.loudness.integratedLufs.toFixed(1)} LUFS`, ref: `${referenceReport.loudness.integratedLufs.toFixed(1)} LUFS`, delta: referenceReport.loudness.integratedLufs - targetReport.loudness.integratedLufs, unit: 'LU' },
        { label: 'True peak', target: `${targetReport.loudness.truePeakDb.toFixed(1)} dBTP`, ref: `${referenceReport.loudness.truePeakDb.toFixed(1)} dBTP`, delta: referenceReport.loudness.truePeakDb - targetReport.loudness.truePeakDb, unit: 'dB' },
        { label: 'Loudness range', target: `${targetReport.loudness.lra.toFixed(1)} LU`, ref: `${referenceReport.loudness.lra.toFixed(1)} LU`, delta: referenceReport.loudness.lra - targetReport.loudness.lra, unit: 'LU' },
        { label: 'Crest factor', target: `${targetReport.loudness.crestDb.toFixed(1)} dB`, ref: `${referenceReport.loudness.crestDb.toFixed(1)} dB`, delta: referenceReport.loudness.crestDb - targetReport.loudness.crestDb, unit: 'dB' },
        { label: 'Stereo width', target: `${targetReport.stereo.widthDb.toFixed(1)} dB`, ref: `${referenceReport.stereo.widthDb.toFixed(1)} dB`, delta: referenceReport.stereo.widthDb - targetReport.stereo.widthDb, unit: 'dB' },
        { label: 'Correlation', target: targetReport.stereo.correlation.toFixed(2), ref: referenceReport.stereo.correlation.toFixed(2), delta: referenceReport.stereo.correlation - targetReport.stereo.correlation, unit: '' },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Reference Match Studio</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-100">Reference Match Studio</h1>
            <HelpTip title="What is reference matching?" steps={['Upload the song you want to improve.', 'Add a professionally released song as a sonic reference.', 'Choose which sound qualities matter to you.', 'Generate a processing chain, listen and adjust it.']}>
              The engine measures frequency balance, loudness, dynamics and stereo behaviour. It creates editable processing suggestions; it does not copy the audio or guarantee an identical sound.
            </HelpTip>
          </div>
          <p className="mt-1 text-xs text-ink-400">Move your mix toward a sound you love, while keeping every creative decision in your hands.</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-400">
            Every suggestion is derived from measured band energy, loudness, dynamics and stereo behaviour. Nothing is
            copied from the reference audio itself, and every generated processor remains editable.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void analyzeProjectAssets()} disabled={!targetId && referenceIds.length === 0}>
            Analyse all
          </Button>
          <Button size="sm" variant="primary" onClick={() => void generateMatch()} disabled={!ready}>
            Generate chain
          </Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Target song" right={targetMeta && <Badge tone={targetReport ? 'accent' : 'warn'}>{targetReport ? 'analysed' : 'not analysed'}</Badge>}>
          {targetMeta ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-ink-100">{targetMeta.name}</p>
                  <p className="font-mono text-2xs text-ink-500">
                    {formatTime(targetMeta.duration)} · {targetMeta.sampleRate} Hz · {targetMeta.channels}ch ·{' '}
                    {targetMeta.bitDepth ? `${targetMeta.bitDepth}-bit` : 'bit depth n/a'}
                  </p>
                </div>
                {!targetReport && (
                  <Button size="sm" onClick={() => targetId && void useApp.getState().analyzeAsset(targetId)}>
                    Analyse
                  </Button>
                )}
              </div>
              <Waveform
                peaks={useApp.getState().assetBuffers[targetMeta.id]?.peaks ?? null}
                duration={targetMeta.duration}
                position={0}
                height={70}
                faded={!targetReport}
              />
              {targetReport && (
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="LUFS" value={targetReport.loudness.integratedLufs.toFixed(1)} />
                  <Stat label="dBTP" value={targetReport.loudness.truePeakDb.toFixed(1)} />
                  <Stat label="Crest" value={`${targetReport.loudness.crestDb.toFixed(1)} dB`} />
                </div>
              )}
              {targetReport?.warnings.map((warning) => (
                <p key={warning} className="text-2xs leading-relaxed text-signal-amber/80">⚠ {warning}</p>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-2xs leading-relaxed text-ink-400">
                Upload the song you want to improve. The original file is stored untouched; processing is non-destructive.
              </p>
              <Button size="sm" variant="primary" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'))}>
                Upload target song
              </Button>
            </div>
          )}
        </Panel>

        <Panel
          title={`References (${references.length})`}
          right={
            <Button size="sm" variant="ghost" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'reference'))}>
              + Add
            </Button>
          }
        >
          {references.length === 0 ? (
            <div className="space-y-2">
              <p className="text-2xs leading-relaxed text-ink-400">
                Add commercial releases you want to use as sonic targets. Multiple references can be combined by
                characteristic.
              </p>
              <Button size="sm" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'reference'))}>
                Upload reference
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {references.map((reference, i) => (
                <div key={reference.id} className="rounded border border-ink-700 bg-ink-850/60 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-2xs text-ink-100">{reference.meta?.name ?? 'Reference'}</p>
                      <p className="font-mono text-2xs text-ink-500">
                        {reference.report
                          ? `${reference.report.loudness.integratedLufs.toFixed(1)} LUFS · ${reference.report.loudness.truePeakDb.toFixed(1)} dBTP`
                          : 'not analysed'}{' '}
                        · ref {i + 1}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {reference.track && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateTrack(reference.track!.id, { muted: !reference.track!.muted })}
                        >
                          {reference.track.muted ? 'audition' : 'mute'}
                        </Button>
                      )}
                      {!reference.report ? (
                        <Button size="sm" onClick={() => void useApp.getState().analyzeAsset(reference.id)}>
                          Analyse
                        </Button>
                      ) : (
                        <Badge tone="info">ready</Badge>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => removeReference(reference.id)}>×</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {references.length > 1 && (
            <p className="mt-2 text-2xs leading-relaxed text-ink-500">
              With multiple references, each category can draw from a different one in Advanced options.
            </p>
          )}
        </Panel>
      </div>

      {comparison.length > 0 && (
        <Panel title="Measured differences" subtitle="Reference minus target. Positive means the reference is higher." right={<HelpTip title="How to read these measurements">The values are measured from your uploaded audio. A positive difference means the reference has a higher measured value than your target. A difference is not automatically a problem: use your ears and the arrangement as context.</HelpTip>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {comparison.map((row) => (
              <div key={row.label} className="rounded border border-ink-700 bg-ink-850/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-ink-400">{row.label}</span>
                  <span className={`font-mono text-2xs ${Math.abs(row.delta) < 1 ? 'text-ink-300' : row.delta > 0 ? 'text-signal-amber' : 'text-signal-cyan'}`}>
                    {row.delta > 0 ? '+' : ''}{row.delta.toFixed(row.unit ? 1 : 2)} {row.unit}
                  </span>
                </div>
                <div className="mt-1 flex justify-between font-mono text-2xs text-ink-500">
                  <span>target {row.target}</span>
                  <span>ref {row.ref}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
        <Panel title="Reference Match controls" subtitle="Intensity scales the corrections perceptually, not by blindly multiplying every parameter.">
          <div className="space-y-3">
            <div className="rounded border border-accent/20 bg-accent/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-ink-100">Global intensity <HelpTip title="Match intensity">This scales the strength of the suggested corrections. Start around 25–50%, listen, then increase only if the changes genuinely improve your mix.</HelpTip></span>
                <span className="font-mono text-xs text-accent">{project.match.intensity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={project.match.intensity}
                onChange={(e) => setMatch({ intensity: Number(e.target.value) })}
                className="mt-2 w-full"
              />
              <div className="mt-1 flex justify-between font-mono text-2xs text-ink-500">
                <span>0 none</span>
                <span>25 subtle</span>
                <span>50 moderate</span>
                <span>75 strong</span>
                <span>100 max</span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {MATCH_CATEGORIES.map((category) => {
                const key = category.key as keyof CategorySource;
                const value = project.match[key] as number;
                return (
                  <div key={category.key} className="rounded border border-ink-700 bg-ink-850/40 p-2">
                    <ParamSlider
                      label={category.label}
                      value={value}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      compact
                      onChange={(next) => setMatch({ [category.key]: next } as Partial<MatchSettings>)}
                    />
                    <p className="mt-1 text-2xs text-ink-500">{category.description}</p>
                  </div>
                );
              })}
            </div>

            <details className="rounded border border-ink-700 bg-ink-900/40">
              <summary className="cursor-pointer px-2 py-1.5 text-2xs uppercase tracking-wider text-ink-400">
                Advanced matching
              </summary>
              <div className="grid gap-3 border-t border-ink-700 p-2.5 sm:grid-cols-2">
                <Select
                  label="Target section"
                  value={project.match.targetSection}
                  options={[{ value: 'full', label: 'Full track' }, { value: 'chorus', label: 'Chorus only' }, { value: 'verse', label: 'Verse only' }]}
                  onChange={(value) => setMatch({ targetSection: value as MatchSettings['targetSection'] })}
                />
                <Select
                  label="Reference section"
                  value={project.match.referenceSection}
                  options={[{ value: 'full', label: 'Full track' }, { value: 'chorus', label: 'Chorus only' }, { value: 'verse', label: 'Verse only' }]}
                  onChange={(value) => setMatch({ referenceSection: value as MatchSettings['referenceSection'] })}
                />
                <ParamSlider label="Max EQ boost" value={project.match.maxEqBoost} min={0} max={18} step={0.5} unit="dB" onChange={(value) => setMatch({ maxEqBoost: value })} />
                <ParamSlider label="Max EQ cut" value={project.match.maxEqCut} min={0} max={18} step={0.5} unit="dB" onChange={(value) => setMatch({ maxEqCut: value })} />
                <ParamSlider label="Max loudness change" value={project.match.maxLoudnessChange} min={0} max={15} step={0.5} unit="dB" onChange={(value) => setMatch({ maxLoudnessChange: value })} />
                <ParamSlider label="Exclude below" value={project.match.excludeLowHz} min={20} max={1000} step={1} unit="Hz" logarithmic onChange={(value) => setMatch({ excludeLowHz: value })} />
                <ParamSlider label="Exclude above" value={project.match.excludeHighHz} min={2000} max={20000} step={10} unit="Hz" logarithmic onChange={(value) => setMatch({ excludeHighHz: value })} />
                <div className="space-y-2">
                  <Toggle checked={project.match.protectLowEnd} onChange={(value) => setMatch({ protectLowEnd: value })} label="Protect sub / low end" description="Never correct below 80 Hz." />
                  <Toggle checked={project.match.protectHighEnd} onChange={(value) => setMatch({ protectHighEnd: value })} label="Protect top end" description="Never correct above 16 kHz." />
                </div>
                {analysedRefs.length > 1 && (
                  <div className="sm:col-span-2">
                    <div className="section-label mb-1">Use each characteristic from</div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {MATCH_CATEGORIES.map((category) => (
                        <Select
                          key={category.key}
                          label={category.label}
                          value={project.match.categorySource[category.key] ?? 0}
                          options={analysedRefs.map((ref, index) => ({ value: index, label: `Ref ${index + 1} · ${ref.meta?.name ?? ''}`.slice(0, 40) }))}
                          onChange={(value) => setMatch({ categorySource: { ...project.match.categorySource, [category.key]: value } })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
        </Panel>

        <Panel title="Tonal comparison" subtitle="Relative band levels. Loudness-independent, so quiet and loud masters compare fairly." right={<HelpTip title="What is tonal balance?">This chart shows how energy is distributed across frequency bands. More bass or treble is not automatically better. Compare broad trends, then listen for muddiness, harshness, missing body or excessive brightness.</HelpTip>}>
          {preview ? (
            <>
              <BandChart bands={preview.before} compare={referenceReport?.spectrum.bands.map((b) => b.relativeDb)} label="Target" compareLabel="Reference" height={170} />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="section-label mb-1">Target buildup</div>
                  <BandBars bands={targetReport!.spectrum.bands} height={70} />
                </div>
                <div>
                  <div className="section-label mb-1">Reference buildup</div>
                  <BandBars bands={referenceReport!.spectrum.bands} height={70} color="#5ad1e6" />
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {(targetReport!.spectrum.resonances.length > 0 || targetReport!.spectrum.buildupBands.length > 0) && (
                  <p className="text-2xs leading-relaxed text-ink-400">
                    Target resonances:{' '}
                    {targetReport!.spectrum.resonances.map((r) => `${r.frequency} Hz (+${r.excessDb.toFixed(1)} dB)`).join(', ') || 'none detected above 4 dB'}.
                  </p>
                )}
                <p className="text-2xs leading-relaxed text-ink-500">
                  Estimated tempo: {targetReport!.rhythm.tempoBpm || '—'} BPM (confidence{' '}
                  {Math.round(targetReport!.rhythm.beatConfidence * 100)}%). Sections: {targetReport!.sections.map((s) => s.label).join(', ')}.
                </p>
              </div>
            </>
          ) : (
            <p className="text-2xs leading-relaxed text-ink-500">
              Analyse the target and at least one reference to see the tonal comparison.
            </p>
          )}
        </Panel>
      </div>

      {matchPlan && (
        <Panel
          title="Generated processing chain"
          subtitle="Preview only — nothing has been applied to the master yet."
          right={<Badge tone="accent">{matchPlan.proposals.length} processors</Badge>}
        >
          <div className="space-y-2">
            {matchPlan.proposals.map((proposal) => (
              <label key={proposal.id} className="flex cursor-pointer gap-2 rounded border border-ink-700 bg-ink-850/50 p-2">
                <input
                  type="checkbox"
                  checked={!excluded.has(proposal.id)}
                  onChange={() => {
                    const next = new Set(excluded);
                    if (next.has(proposal.id)) next.delete(proposal.id);
                    else next.add(proposal.id);
                    setExcluded(next);
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-100">{proposal.processorName}</span>
                    <Badge tone="neutral">{proposal.category}</Badge>
                    <span className="font-mono text-2xs text-ink-500">confidence {Math.round(proposal.confidence * 100)}%</span>
                    <HelpTip title="About confidence">Confidence estimates how strongly the measured data supports this suggestion. It is a guidance signal, not a guarantee of sound quality.</HelpTip>
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-300">{proposal.reason}</p>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-500">Expected: {proposal.expected}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {proposal.before.map((metric) => (
                      <span key={metric.label} className="font-mono text-2xs text-ink-500">
                        {metric.label}: {metric.target} → {metric.reference} ({metric.delta})
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            ))}
            {matchPlan.warnings.map((warning) => (
              <p
                key={warning.message}
                className={`rounded border p-2 text-2xs leading-relaxed ${
                  warning.kind === 'warning'
                    ? 'border-signal-amber/30 bg-signal-amber/5 text-signal-amber'
                    : warning.kind === 'limitation'
                      ? 'border-signal-red/25 bg-signal-red/5 text-signal-red/90'
                      : 'border-ink-600 bg-ink-850 text-ink-400'
                }`}
              >
                {warning.message}
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 pt-2">
              <Button
                variant="primary"
                onClick={() => applyMatchPlan(matchPlan.proposals.filter((p) => !excluded.has(p.id)).map((p) => p.id))}
              >
                Apply {matchPlan.proposals.length - excluded.size} processors to master
              </Button>
              <Button onClick={() => void verifyMaster()}>Render & measure master</Button>
              <Button variant="ghost" onClick={() => useApp.getState().setScreen('mastering')}>Open mastering</Button>
              <span className="ml-auto text-2xs text-ink-500">
                Predicted {matchPlan.predicted.integratedLufs.toFixed(1)} LUFS · {matchPlan.predicted.truePeakDb.toFixed(1)} dBTP
              </span>
            </div>
          </div>
        </Panel>
      )}

      {lastRenderStats && (
        <Panel title="Measured master (offline render)">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Integrated" value={`${lastRenderStats.lufs.toFixed(1)} LUFS`} />
            <Stat label="True peak" value={`${lastRenderStats.truePeakDb.toFixed(1)} dBTP`} />
            <Stat label="LRA" value={`${lastRenderStats.lra.toFixed(1)} LU`} />
            <Stat label="Render time" value={`${(lastRenderStats.elapsedMs / 1000).toFixed(2)} s`} />
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-ink-500">
            These are measurements of the actual rendered audio, not predictions. Matching cannot guarantee an identical
            result to the reference: arrangement, performance and source production still dominate the sound.
          </p>
        </Panel>
      )}

      <Panel title="Limits of reference matching">
        <div className="grid gap-3 text-2xs leading-relaxed text-ink-400 md:grid-cols-3">
          <p>
            Matching operates on measurable production properties: spectral balance, loudness, dynamics, stereo width and
            transient behaviour. It never copies the reference waveform, melody, samples or arrangement.
          </p>
          <p>
            If your source is already over-compressed, dynamic range cannot be restored. The engine reports this instead of
            pretending an expander can recreate lost transients.
          </p>
          <p>
            Prediction values are model-based. Use <span className="text-ink-200">Render &amp; measure master</span> to
            verify what the chain actually does before exporting.
          </p>
        </div>
      </Panel>
      <Busy />
      {busy && <span className="sr-only">{busy.label}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-ink-700 bg-ink-850/50 px-2 py-1.5">
      <div className="text-2xs text-ink-500">{label}</div>
      <div className="font-mono text-xs text-ink-100">{value}</div>
    </div>
  );
}

function Busy() {
  const busy = useApp((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="rounded border border-accent/20 bg-accent/5 p-2 text-2xs text-accent">
      {busy.label} · {Math.round(busy.progress * 100)}%
    </div>
  );
}

void InfoRow;
