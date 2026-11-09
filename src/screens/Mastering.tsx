import { useState, type DragEvent } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, HelpTip, InfoRow, Panel, ParamSlider, Select, Toggle, useFilePicker } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { Rack } from '../ui/Rack';
import { GainReductionMeter, LevelMeter, LoudnessChart, Waveform, useMeters } from '../ui/viz';
import { TransportBar } from '../ui/Mixer';
import { formatDb, formatTime } from '../audio/dsp/util';

const DELIVERY_TARGETS = [
  { id: 'streaming', label: 'Streaming (general)', lufs: -14, tp: -1 },
  { id: 'youtube', label: 'YouTube', lufs: -14, tp: -1 },
  { id: 'social', label: 'Social media', lufs: -12, tp: -1 },
  { id: 'cd', label: 'CD / loud master', lufs: -9, tp: -1 },
  { id: 'lossless', label: 'Lossless digital release', lufs: -14, tp: -1 },
];

const MASTERING_STYLES = [
  { id: 'master-transparent', label: 'Balanced', description: 'Clean, controlled and transparent.', detail: 'A restrained starting point with clean peak control.', color: '#8957FF' },
  { id: 'master-warm', label: 'Warm', description: 'Weight, glue and a softer top end.', detail: 'A gentle colour-focused starting point.', color: '#E6AD3D' },
  { id: 'master-modern-pop', label: 'Bright', description: 'Forward presence and a modern polished edge.', detail: 'A brighter, denser pop-oriented starting point.', color: '#55B7EA' },
] as const;

export default function Mastering({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    project,
    assets,
    assetBuffers,
    presets,
    importFiles,
    applyPreset,
    verifyMaster,
    lastRenderStats,
    busy,
    abSlots,
    captureSlot,
    recallSlot,
    deleteSlot,
    activeSlot,
    loudnessMatch,
    setLoudnessMatch,
    comparisonDb,
    setTargets,
    setScreen,
    selectedProcessorId,
    selectProcessor,
    analyses,
  } = useApp();
  const meters = useMeters();
  const picker = useFilePicker();
  const [targetPreset, setTargetPreset] = useState('streaming');
  const [selectedStyle, setSelectedStyle] = useState<(typeof MASTERING_STYLES)[number]['id']>('master-transparent');

  if (!project) return <div className="p-5"><Panel>Open a project to use the mastering workspace.</Panel></div>;

  const master = project.master;
  const limiterReduction = master.processors.reduce((sum, node) => sum + (meters.gr.master?.[node.id]?.reduction ?? 0), 0);
  const targetAssetId = project.targetAssetIds[0];
  const targetMeta = assets.find((asset) => asset.id === targetAssetId);
  const targetBuffer = targetAssetId ? assetBuffers[targetAssetId] : undefined;
  const targetReport = targetAssetId ? analyses[targetAssetId] : undefined;
  const measured = lastRenderStats;
  const targetLufs = project.targetLufs ?? -14;
  const targetTp = project.targetTruePeak ?? -1;
  const selectedPreset = presets.find((preset) => preset.id === selectedStyle);
  const selectedStyleInfo = MASTERING_STYLES.find((style) => style.id === selectedStyle) ?? MASTERING_STYLES[0];

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) void importFiles(files, 'target');
  };

  const startMastering = () => {
    void verifyMaster();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sonora-canvas">
      {!embedded && (
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[.07] bg-[#0D0D1B]/75 px-5 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-[-.025em] text-white">Mastering</h1>
            <HelpTip title="What happens during mastering?" steps={['Balance the overall tone.', 'Control peaks and dynamics.', 'Check loudness against your delivery goal.', 'Render and measure the finished audio.']}>
              Mastering processes the complete mix. It cannot independently fix a vocal or instrument inside a stereo file; use stems and the Mixing Studio when individual elements need changes.
            </HelpTip>
          </div>
          <p className="mt-1 text-sm text-ink-400">Give your track the final polish, then verify the actual render.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="neutral">{master.processors.length} processors</Badge>
          <Button size="md" variant="primary" disabled={busy?.kind === 'render'} onClick={startMastering}>
            <Icon name="sparkles" size={14} /> {busy?.kind === 'render' ? 'Mastering…' : 'Start mastering'}
          </Button>
          <Button size="md" variant="secondary" onClick={() => setScreen('export')}>
            <Icon name="download" size={14} /> Export
          </Button>
        </div>
      </header>
      )}

      {!embedded && <TransportBar />}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto w-full max-w-[1600px] space-y-5 ${embedded ? 'p-4 sm:p-5' : 'p-5 sm:p-6 lg:p-7'}`}>
          <section className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
            <Panel dataTour="mastering-upload" title="Your track" subtitle="The original audio remains untouched; mastering uses the current project chain.">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className={`rounded-xl border border-dashed p-4 transition-colors ${targetMeta ? 'border-[#8957FF]/25 bg-[#8957FF]/[.035]' : 'border-white/[.14] bg-[#0D0D1B]/60 hover:border-[#A77AFF]/50'}`}
              >
                {targetMeta ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#A77AFF]/30 bg-[#8957FF]/10 text-[#C4A2FF]">
                          <Icon name="waveform" size={20} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-100">{targetMeta.name}</p>
                          <p className="mt-0.5 text-2xs text-ink-500">{formatTime(targetMeta.duration)} · {targetMeta.sampleRate.toLocaleString()} Hz · {targetMeta.channels} channel{targetMeta.channels === 1 ? '' : 's'}</p>
                        </div>
                      </div>
                      <Badge tone={targetReport ? 'accent' : 'warn'}>{targetReport ? 'Analysed' : 'Analysis pending'}</Badge>
                    </div>
                    <div className="rounded-lg border border-white/[.06] bg-[#090914]/70 p-2">
                      <Waveform peaks={targetBuffer?.peaks ?? null} duration={targetMeta.duration} position={0} height={78} color="#8957FF" faded={!targetReport} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-2xs text-ink-500">{targetReport ? `Source loudness ${targetReport.loudness.integratedLufs.toFixed(1)} LUFS · true peak ${targetReport.loudness.truePeakDb.toFixed(1)} dBTP` : 'Run analysis to inspect the source before rendering.'}</p>
                      <div className="flex gap-1.5">
                        {!targetReport && <Button size="sm" onClick={() => targetAssetId && void useApp.getState().analyzeAsset(targetAssetId)}>Analyse</Button>}
                        <Button size="sm" variant="ghost" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'))}>Replace track</Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#A77AFF]/25 bg-[#8957FF]/10 text-[#C4A2FF]">
                      <Icon name="upload" size={24} />
                    </span>
                    <p className="text-sm font-semibold text-ink-100">Drag &amp; drop your track</p>
                    <p className="mt-1 text-xs text-ink-500">or choose an audio file from your device</p>
                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'))}>
                      Browse files
                    </Button>
                    <p className="mt-3 text-[10px] text-ink-600">WAV · AIFF · FLAC · MP3 · AAC · OGG</p>
                  </div>
                )}
              </div>
            </Panel>

            <Panel dataTour="mastering-styles" title="Choose a style" subtitle="These are real, editable processor-chain starting points.">
              <div className="space-y-2">
                {MASTERING_STYLES.map((style) => {
                  const active = selectedStyle === style.id;
                  const preset = presets.find((item) => item.id === style.id);
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyle(style.id)}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-180 ${active ? 'border-[#A77AFF]/45 bg-[#8957FF]/[.12] shadow-violet-soft' : 'border-white/[.07] bg-[#0D0D1B]/55 hover:border-white/[.15] hover:bg-white/[.035]'}`}
                    >
                      <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-white/[.06] bg-black/20" style={{ color: style.color }}>
                        <Icon name="audio-lines" size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-ink-100">{style.label}</span>
                        <span className="mt-0.5 block text-2xs text-ink-400">{style.description}</span>
                        <span className="mt-1 block text-[9px] text-ink-600">{preset ? `${preset.processors.length} processors · editable chain` : style.detail}</span>
                      </span>
                      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${active ? 'border-[#A77AFF] bg-[#8957FF]' : 'border-ink-500'}`}>
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.07] pt-3">
                  <p className="max-w-[240px] text-2xs leading-relaxed text-ink-500">Loading a starting point replaces the current master chain. You can edit every processor and undo the change.</p>
                  <Button size="sm" variant="secondary" disabled={!selectedPreset} onClick={() => applyPreset(selectedStyle, 'master', null)}>
                    Use {selectedStyleInfo.label}
                  </Button>
                </div>
              </div>
            </Panel>
          </section>

          <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
            <Panel dataTour="mastering-metering" title="Master metering" subtitle="Peak and gain reduction are live; loudness is measured from an offline render." right={<HelpTip title="Understanding the meters">Peak shows the signal level. Gain reduction shows how much a dynamics processor is turning the signal down. LUFS describes perceived loudness; dBTP measures estimated reconstructed peaks.</HelpTip>}>
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <div className="flex gap-3">
                  <div className="text-center">
                    <LevelMeter db={meters.peakL} peakDb={meters.peakL} height={132} width={14} />
                    <span className="mt-1 block font-mono text-2xs text-ink-500">peak</span>
                  </div>
                  <div className="text-center">
                    <GainReductionMeter reductionDb={limiterReduction} height={132} />
                    <span className="mt-1 block font-mono text-2xs text-ink-500">GR</span>
                  </div>
                </div>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <InfoRow label="Peak" value={`${meters.peakL.toFixed(1)} dB`} />
                  <InfoRow label="Gain reduction" value={`${limiterReduction.toFixed(1)} dB`} />
                  <InfoRow label="Measured LUFS" value={measured ? measured.lufs.toFixed(1) : 'render to measure'} />
                  <InfoRow label="Measured true peak" value={measured ? `${measured.truePeakDb.toFixed(1)} dBTP` : '—'} />
                  <InfoRow label="Loudness range" value={measured ? `${measured.lra.toFixed(1)} LU` : '—'} />
                  <InfoRow label="Source LUFS" value={targetReport ? targetReport.loudness.integratedLufs.toFixed(1) : 'not analysed'} />
                  <InfoRow label="Headroom to target" value={measured ? `${formatDb(targetLufs - measured.lufs)} LU` : '—'} tone={measured && measured.lufs > targetLufs + 0.5 ? 'text-signal-amber' : 'text-ink-100'} />
                  <InfoRow label="Ceiling status" value={measured ? (measured.truePeakDb <= targetTp + 0.1 ? 'within limit' : 'over limit') : '—'} tone={measured && measured.truePeakDb > targetTp ? 'text-signal-red' : 'text-signal-green'} />
                </div>
              </div>
              {targetReport && <div className="mt-3"><div className="section-label mb-1">Source loudness over time</div><LoudnessChart points={targetReport.loudness.shortTerm} target={targetLufs} height={84} /></div>}
              <p className="mt-2 text-2xs leading-relaxed text-ink-500">The engine prioritises clean peaks over loudness. If the requested level cannot be met within the true-peak ceiling, the measured result will land lower instead of clipping.</p>
            </Panel>

            <div className="space-y-3">
              <Panel title="Delivery target" right={<HelpTip title="Choosing a delivery target">These are starting points, not compulsory loudness rules. Follow the current requirements of your distributor or platform.</HelpTip>}>
                <Select label="Starting point" value={targetPreset} options={[...DELIVERY_TARGETS.map((target) => ({ value: target.id, label: target.label })), { value: 'custom', label: 'Custom' }]} onChange={(value) => {
                  setTargetPreset(value);
                  const preset = DELIVERY_TARGETS.find((item) => item.id === value);
                  if (preset) setTargets(preset.lufs, preset.tp);
                }} />
                <div className="mt-3 space-y-3">
                  <ParamSlider label="Target loudness" value={targetLufs} min={-24} max={-5} step={0.5} unit="LUFS" onChange={(value) => { setTargetPreset('custom'); setTargets(value, targetTp); }} />
                  <ParamSlider label="True peak ceiling" value={targetTp} min={-6} max={-0.1} step={0.1} unit="dBTP" onChange={(value) => { setTargetPreset('custom'); setTargets(targetLufs, value); }} />
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-ink-500">Configurable starting points, not universal platform rules. Check your distributor's current requirements.</p>
              </Panel>

              <Panel title="A/B comparison" right={<HelpTip title="Why match listening volume?">A louder master can seem better even when it is more distorted. Loudness-matched listening compensates monitor volume only; it does not alter the exported audio.</HelpTip>}>
                <div className="grid grid-cols-4 gap-1.5">
                  {['A', 'B', 'C', 'D'].map((label) => {
                    const slot = abSlots.find((item) => item.label === label);
                    return (
                      <div key={label} className={`rounded-lg border p-2 ${activeSlot === slot?.id ? 'border-[#A77AFF]/45 bg-[#8957FF]/10' : 'border-white/[.07] bg-[#0D0D1B]/50'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-ink-100">{label}</span>
                          {slot ? <button type="button" className="text-2xs text-ink-500 hover:text-signal-red" onClick={() => deleteSlot(slot.id)}>×</button> : <span className="text-[9px] text-ink-600">empty</span>}
                        </div>
                        {slot ? (
                          <>
                            <div className="mt-1 font-mono text-[9px] text-ink-500">{slot.lufs !== null ? `${slot.lufs.toFixed(1)} LUFS` : 'unmeasured'}</div>
                            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => recallSlot(slot.id)}>Recall</Button>
                          </>
                        ) : <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => captureSlot(label)}>Capture</Button>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1.5">
                  <Toggle checked={loudnessMatch} onChange={setLoudnessMatch} label="Loudness-matched listening" description="Monitor-only gain keeps louder versions from seeming automatically better." />
                  <p className="font-mono text-2xs text-ink-500">Comparison gain {comparisonDb >= 0 ? '+' : ''}{comparisonDb.toFixed(1)} dB</p>
                </div>
              </Panel>
            </div>
          </div>

          <Panel dataTour="mastering-chain" title="Master chain" subtitle="Drag to reorder. Bypass, duplicate, reset or remove any processor.">
            <div className="max-h-[520px] overflow-auto">
              <Rack scope="master" trackId={null} processors={master.processors} selectedId={selectedProcessorId} onSelect={selectProcessor} meters={meters.gr.master ?? {}} emptyHint="Start from a mastering preset or reference match, then edit each processor." />
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}
