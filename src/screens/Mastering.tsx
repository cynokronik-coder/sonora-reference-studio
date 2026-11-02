import { useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, InfoRow, Panel, ParamSlider, Select, Toggle } from '../ui/Primitives';
import { Rack } from '../ui/Rack';
import { GainReductionMeter, LevelMeter, LoudnessChart, useMeters } from '../ui/viz';
import { TransportBar } from '../ui/Mixer';
import { formatDb } from '../audio/dsp/util';

const DELIVERY_TARGETS = [
  { id: 'streaming', label: 'Streaming (general)', lufs: -14, tp: -1 },
  { id: 'youtube', label: 'YouTube', lufs: -14, tp: -1 },
  { id: 'social', label: 'Social media', lufs: -12, tp: -1 },
  { id: 'cd', label: 'CD / loud master', lufs: -9, tp: -1 },
  { id: 'lossless', label: 'Lossless digital release', lufs: -14, tp: -1 },
];

export default function Mastering() {
  const { project, verifyMaster, lastRenderStats, busy, abSlots, captureSlot, recallSlot, deleteSlot, activeSlot, loudnessMatch, setLoudnessMatch, comparisonDb, setTargets, setScreen, selectedProcessorId, selectProcessor, analyses } = useApp();
  const meters = useMeters();
  const [targetPreset, setTargetPreset] = useState('streaming');
  if (!project) return <div className="p-5"><Panel>Open a project to use the mastering workspace.</Panel></div>;
  const master = project.master;
  const limiterReduction = master.processors.reduce((sum, node) => sum + (meters.gr.master?.[node.id]?.reduction ?? 0), 0);
  const targetReport = project.targetAssetIds[0] ? analyses[project.targetAssetIds[0]] : undefined;
  const measured = lastRenderStats;
  const targetLufs = project.targetLufs ?? -14;
  const targetTp = project.targetTruePeak ?? -1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm text-ink-100">Mastering</h1>
          <Badge tone="accent">{master.processors.length} processors</Badge>
          <Badge>target {targetLufs.toFixed(1)} LUFS / {targetTp.toFixed(1)} dBTP</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void verifyMaster()} disabled={busy?.kind === 'render'}>
            Render &amp; measure
          </Button>
          <Button size="sm" variant="primary" onClick={() => setScreen('export')}>
            Export
          </Button>
        </div>
      </div>
      <TransportBar />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="grid gap-3 p-3 lg:grid-cols-[1fr_320px]">
            <Panel title="Master metering" subtitle="Peak and gain reduction come from the engine. Loudness is measured from an offline render.">
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <div className="flex gap-2">
                  <div className="text-center">
                    <LevelMeter db={meters.peakL} peakDb={meters.peakL} height={150} width={14} />
                    <span className="mt-1 block font-mono text-2xs text-ink-500">peak</span>
                  </div>
                  <div className="text-center">
                    <GainReductionMeter reductionDb={limiterReduction} height={150} />
                    <span className="mt-1 block font-mono text-2xs text-ink-500">GR</span>
                  </div>
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  <InfoRow label="Peak" value={`${meters.peakL.toFixed(1)} dB`} />
                  <InfoRow label="Gain reduction" value={`${limiterReduction.toFixed(1)} dB`} />
                  <InfoRow label="Measured LUFS" value={measured ? `${measured.lufs.toFixed(1)}` : 'render to measure'} />
                  <InfoRow label="Measured true peak" value={measured ? `${measured.truePeakDb.toFixed(1)} dBTP` : '—'} />
                  <InfoRow label="Loudness range" value={measured ? `${measured.lra.toFixed(1)} LU` : '—'} />
                  <InfoRow label="Source LUFS" value={targetReport ? targetReport.loudness.integratedLufs.toFixed(1) : 'not analysed'} />
                  <InfoRow
                    label="Headroom to target"
                    value={measured ? `${formatDb(targetLufs - measured.lufs)} LU` : '—'}
                    tone={measured && measured.lufs > targetLufs + 0.5 ? 'text-signal-amber' : 'text-ink-100'}
                  />
                  <InfoRow
                    label="Ceiling status"
                    value={measured ? (measured.truePeakDb <= targetTp + 0.1 ? 'within limit' : 'over limit') : '—'}
                    tone={measured && measured.truePeakDb > targetTp ? 'text-signal-red' : 'text-accent'}
                  />
                </div>
              </div>
              {targetReport && (
                <div className="mt-3">
                  <div className="section-label mb-1">Source loudness over time</div>
                  <LoudnessChart points={targetReport.loudness.shortTerm} target={targetLufs} height={80} />
                </div>
              )}
              <p className="mt-2 text-2xs leading-relaxed text-ink-500">
                The engine prioritises clean peaks over loudness. If the requested level cannot be met within the true-peak
                ceiling, the measured result will land lower instead of clipping.
              </p>
            </Panel>

            <div className="space-y-3">
              <Panel title="Delivery target">
                <Select
                  label="Starting point"
                  value={targetPreset}
                  options={[...DELIVERY_TARGETS.map((t) => ({ value: t.id, label: t.label })), { value: 'custom', label: 'Custom' }]}
                  onChange={(value) => {
                    setTargetPreset(value);
                    const preset = DELIVERY_TARGETS.find((t) => t.id === value);
                    if (preset) setTargets(preset.lufs, preset.tp);
                  }}
                />
                <div className="mt-2 space-y-2">
                  <ParamSlider label="Target loudness" value={targetLufs} min={-24} max={-5} step={0.5} unit="LUFS" onChange={(value) => { setTargetPreset('custom'); setTargets(value, targetTp); }} />
                  <ParamSlider label="True peak ceiling" value={targetTp} min={-6} max={-0.1} step={0.1} unit="dBTP" onChange={(value) => { setTargetPreset('custom'); setTargets(targetLufs, value); }} />
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-500">
                  These are configurable starting points informed by common delivery specs — not a universal rule. Always
                  check your distributor's current requirement.
                </p>
              </Panel>

              <Panel title="A/B comparison">
                <div className="grid grid-cols-2 gap-1.5">
                  {['A', 'B', 'C', 'D'].map((label) => {
                    const slot = abSlots.find((s) => s.label === label);
                    return (
                      <div key={label} className={`rounded border p-1.5 ${activeSlot === slot?.id ? 'border-accent/40 bg-accent/5' : 'border-ink-700'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-ink-100">{label}</span>
                          {slot ? (
                            <button type="button" className="text-2xs text-ink-500 hover:text-signal-red" onClick={() => deleteSlot(slot.id)}>×</button>
                          ) : (
                            <span className="text-2xs text-ink-600">empty</span>
                          )}
                        </div>
                        {slot ? (
                          <>
                            <div className="mt-0.5 font-mono text-2xs text-ink-500">
                              {slot.lufs ? `${slot.lufs.toFixed(1)} LUFS` : 'LUFS unmeasured'}
                            </div>
                            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => recallSlot(slot.id)}>
                              Recall
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => captureSlot(label)}>
                            Capture
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 space-y-1">
                  <Toggle
                    checked={loudnessMatch}
                    onChange={setLoudnessMatch}
                    label="Loudness-matched listening"
                    description="Applies a monitor-only gain so a quieter version is not mistaken for a worse one."
                  />
                  <p className="font-mono text-2xs text-ink-500">comparison gain {comparisonDb >= 0 ? '+' : ''}{comparisonDb.toFixed(1)} dB</p>
                </div>
              </Panel>
            </div>
          </div>

          <div className="px-3 pb-3">
            <Panel title="Master chain" subtitle="Drag to reorder. Bypass, duplicate, reset or remove any processor.">
              <div className="max-h-[520px] overflow-auto">
                <Rack
                  scope="master"
                  trackId={null}
                  processors={master.processors}
                  selectedId={selectedProcessorId}
                  onSelect={selectProcessor}
                  meters={meters.gr.master ?? {}}
                  emptyHint="Start from the reference match, or add EQ, compression, saturation, clipping and limiting manually."
                />
              </div>
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}
