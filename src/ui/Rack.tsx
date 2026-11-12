import { useEffect, useMemo, useState } from 'react';
import type { ProcessorNodeState } from '../audio/model/types';
import { PROCESSOR_DEFINITIONS, getDefinition, formatParam } from '../audio/dsp/registry';
import type { ParamSpec, ProcessorCategory } from '../audio/dsp/types';
import { useApp } from '../state/store';
import type { ChainScope } from '../audio/model/project';
import { Badge, Button, HelpTip, IconButton, Modal, ParamSlider, Select, Toggle } from './Primitives';
import { EQCurve, GainReductionMeter } from './viz';
import { clamp } from '../audio/dsp/util';
import { COMPRESSOR_PRESETS } from '../audio/dsp/processors/compressor';
import { MULTIBAND_COMP_PRESETS } from '../audio/dsp/processors/multiband';
import { EQ_PRESETS } from '../audio/dsp/processors/eq';
import { DYNAMIC_EQ_PRESETS } from '../audio/dsp/processors/dynamicEq';
import { RESONANCE_PRESETS } from '../audio/dsp/processors/resonance';
import { DEESSER_PRESETS } from '../audio/dsp/processors/deesser';
import { TRANSIENT_PRESETS } from '../audio/dsp/processors/transient';
import { GATE_PRESETS } from '../audio/dsp/processors/gate';
import { SATURATION_PRESETS } from '../audio/dsp/processors/saturation';
import { EXCITER_PRESETS } from '../audio/dsp/processors/exciter';
import { CLIPPER_PRESETS, LIMITER_PRESETS } from '../audio/dsp/processors/limiter';
import { STEREO_PRESETS } from '../audio/dsp/processors/stereo';

const CATEGORY_ORDER: ProcessorCategory[] = ['eq', 'dynamics', 'saturation', 'stereo', 'time', 'vocal', 'mastering', 'utility'];
const CATEGORY_LABELS: Record<ProcessorCategory, string> = {
  eq: 'EQ & tone',
  dynamics: 'Dynamics',
  saturation: 'Saturation & harmonics',
  stereo: 'Stereo',
  time: 'Reverb & delay',
  vocal: 'Vocal tools',
  mastering: 'Mastering',
  utility: 'Utility',
};

export function Rack({
  scope,
  trackId,
  processors,
  selectedId,
  onSelect,
  meters,
  emptyHint,
  filterCategory,
}: {
  scope: ChainScope;
  trackId: string | null;
  processors: ProcessorNodeState[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  meters?: Record<string, { reduction?: number; peakL?: number; peakR?: number; bands?: number[] }>;
  emptyHint?: string;
  filterCategory?: ProcessorCategory | 'effects' | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const { addProcessor, moveProcessor, mode } = useApp();
  const selected = processors.find((p) => p.id === selectedId) ?? null;

  const visibleDefinitions = useMemo(
    () =>
      PROCESSOR_DEFINITIONS.filter(
        (def) => !search.trim() || def.name.toLowerCase().includes(search.toLowerCase()) || def.type.includes(search.toLowerCase()),
      ),
    [search],
  );

  const visibleProcessors = processors
    .map((node, index) => ({ node, index, definition: getDefinition(node.type) }))
    .filter(({ definition }) => {
      if (!definition) return false;
      if (!filterCategory) return true;
      if (filterCategory === 'effects') {
        return ['saturation', 'stereo', 'time', 'vocal', 'utility', 'mastering'].includes(definition.category);
      }
      return definition.category === filterCategory;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/[.07] px-4 py-3">
        <div>
          <div className="flex items-center gap-2"><div className="section-label">Processing chain</div><HelpTip title="What is a processing chain?">Audio flows through processors in order. Each processor changes the signal before it reaches the next one. Drag processors to reorder them, bypass one to compare, or select it to edit its settings.</HelpTip></div>
          <div className="mt-0.5 text-2xs text-ink-500">
            {processors.filter((p) => p.enabled).length} active · {processors.length} total
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
            + Processor
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {processors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-xs text-ink-300">No processors on this chain.</p>
            <p className="max-w-xs text-2xs leading-relaxed text-ink-500">
              {emptyHint ?? 'Add a processor, load a preset, or generate a chain from a reference track.'}
            </p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Add the first processor
            </Button>
          </div>
        ) : visibleProcessors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-xs text-ink-300">No {filterCategory === 'effects' ? 'effects' : filterCategory} processors on this chain.</p>
            <p className="max-w-xs text-2xs leading-relaxed text-ink-500">Choose another processing view or add a compatible processor.</p>
            <Button size="sm" onClick={() => setAddOpen(true)}>Browse processors</Button>
          </div>
        ) : null}
        {visibleProcessors.map(({ node, index, definition: def }) => {
          if (!def) return null;
          const isSelected = node.id === selectedId;
          const meter = meters?.[node.id];
          const reduction = meter?.reduction ?? 0;
          return (
            <div
              key={node.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) moveProcessor(scope, trackId, dragIndex, index);
                setDragIndex(null);
              }}
              className={`mb-2 overflow-hidden rounded-xl border transition-all duration-180 ${
                isSelected ? 'border-[#A77AFF]/45 bg-[#8957FF]/[.09] shadow-violet-soft' : 'border-white/[.07] bg-[#171727]/75 hover:border-white/[.14] hover:bg-[#1D1D30]'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="cursor-grab select-none text-xs tracking-[-.15em] text-ink-600" title="Drag to reorder">
                  ⋮⋮
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : node.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className={`block truncate text-xs ${node.enabled ? 'text-ink-100' : 'text-ink-500 line-through'}`}>
                    {def.name}
                  </span>
                  <span className="block truncate text-2xs text-ink-500">
                    {node.note ? node.note.slice(0, 72) : def.purpose}
                  </span>
                </button>
                {reduction > 0.1 && (
                  <span className="font-mono text-2xs text-signal-amber">-{reduction.toFixed(1)}</span>
                )}
                <div className="flex items-center gap-1">
                  <IconButton
                    title={node.enabled ? 'Bypass' : 'Enable'}
                    active={node.enabled}
                    onClick={() => {
                      const chain = { scope, trackId };
                      void chain;
                      useApp.getState().toggleProcessor(scope, trackId, node.id);
                    }}
                  >
                    {node.enabled ? 'on' : 'off'}
                  </IconButton>
                </div>
              </div>

              {isSelected && (
                <div className="border-t border-white/[.07] bg-[#0D0D1B]/70 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2"><p className="max-w-[70%] text-2xs leading-relaxed text-ink-400">{def.description}</p><HelpTip title={def.name}>{def.description} Start with small adjustments, bypass the processor to compare, and keep the change only if it improves the result.</HelpTip></div>
                    <div className="flex gap-1">
                      <IconButton title="Duplicate" onClick={() => useApp.getState().duplicateProcessor(scope, trackId, node.id)}>
                        dup
                      </IconButton>
                      <IconButton title="Reset parameters" onClick={() => useApp.getState().resetProcessor(scope, trackId, node.id)}>
                        reset
                      </IconButton>
                      <IconButton
                        title="Remove"
                        onClick={() => useApp.getState().removeProcessor(scope, trackId, node.id)}
                        className="!border-signal-red/30 !text-signal-red"
                      >
                        del
                      </IconButton>
                    </div>
                  </div>

                  {node.note && (
                    <div className="mb-2 rounded-lg border border-[#A77AFF]/20 bg-[#8957FF]/[.08] p-2.5 text-2xs leading-relaxed text-ink-300">
                      <span className="mr-1 font-mono uppercase tracking-wider text-accent/80">why</span>
                      {node.note}
                    </div>
                  )}

                  {node.type === 'eq' && (
                    <div className="mb-2">
                      <EQCurve params={node.params} height={120} />
                    </div>
                  )}

                  {node.type === 'dynamicEq' && meter?.bands && (
                    <div className="mb-3 grid grid-cols-4 gap-2">
                      {meter.bands.map((value, bandIndex) => {
                        const reductionDb = Math.abs(value);
                        return (
                          <div key={bandIndex} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">Band {bandIndex + 1}</span>
                              <span className="font-mono text-[10px] text-signal-amber">{reductionDb > 0.05 ? `-${reductionDb.toFixed(1)}` : '0.0'} dB</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp((reductionDb / 18) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {node.type === 'limiter' && meter && (
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {([
                        ['Left', meter.peakL ?? 0],
                        ['Right', meter.peakR ?? 0],
                      ] as const).map(([label, peak]) => {
                        const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
                        return (
                          <div key={label} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">{label} output peak</span>
                              <span className="font-mono text-[10px] text-signal-amber">{peakDb.toFixed(1)} dBFS</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp(((peakDb + 60) / 60) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {node.type === 'clipper' && meter?.bands && (
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {(['Left', 'Right'] as const).map((label, channelIndex) => {
                        const reductionDb = Math.abs(meter.bands?.[channelIndex] ?? 0);
                        return (
                          <div key={label} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">{label} clip</span>
                              <span className="font-mono text-[10px] text-signal-amber">{reductionDb > 0.05 ? `-${reductionDb.toFixed(1)}` : '0.0'} dB</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp((reductionDb / 18) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {node.type === 'gate' && meter?.bands && (
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {(['Left', 'Right'] as const).map((label, channelIndex) => {
                        const reductionDb = Math.abs(meter.bands?.[channelIndex] ?? 0);
                        return (
                          <div key={label} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">{label}</span>
                              <span className="font-mono text-[10px] text-signal-amber">{reductionDb > 0.05 ? `-${reductionDb.toFixed(1)}` : '0.0'} dB</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp((reductionDb / 18) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {node.type === 'resonance' && meter?.bands && (
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      {meter.bands.map((value, bandIndex) => {
                        const reductionDb = Math.abs(value);
                        return (
                          <div key={bandIndex} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">Notch {bandIndex + 1}</span>
                              <span className="font-mono text-[10px] text-signal-amber">{reductionDb > 0.05 ? `-${reductionDb.toFixed(1)}` : '0.0'} dB</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp((reductionDb / 18) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {node.type === 'multibandComp' && meter?.bands && (
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      {(['Low', 'Mid', 'High'] as const).map((label, bandIndex) => {
                        const reductionDb = Math.abs(meter.bands?.[bandIndex] ?? 0);
                        return (
                          <div key={label} className="rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-500">{label}</span>
                              <span className="font-mono text-[10px] text-signal-amber">{reductionDb > 0.05 ? `-${reductionDb.toFixed(1)}` : '0.0'} dB</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                              <div className="h-full rounded-full bg-[#A77AFF] transition-[width]" style={{ width: `${clamp((reductionDb / 18) * 100, 0, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <ProcessorParams scope={scope} trackId={trackId} node={node} advanced={mode === 'advanced'} />

                  {(node.type === 'compressor' || node.type === 'multibandComp' || node.type === 'dynamicEq' || node.type === 'resonance' || node.type === 'deesser' || node.type === 'gate' || node.type === 'clipper' || node.type === 'limiter') && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-2xs text-ink-500">Gain reduction</span>
                      <GainReductionMeter reductionDb={reduction} height={8} />
                      <span className="font-mono text-2xs text-signal-amber">{reduction > 0.05 ? `-${reduction.toFixed(1)} dB` : '0.0 dB'}</span>
                    </div>
                  )}

                  {(node.type === 'compressor' || node.type === 'multibandComp') && (
                    <SidechainSelect scope={scope} trackId={trackId} node={node} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/[.07] px-4 py-2.5 text-2xs text-ink-500">
        {selected ? (
          <span>
            Editing <span className="text-ink-200">{getDefinition(selected.type)?.name}</span> · changes are non-destructive
          </span>
        ) : (
          <span>Select a processor to edit every parameter.</span>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add processor" wide>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search processors…"
          className="focus-ring mb-3 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500"
        />
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {CATEGORY_ORDER.map((category) => {
            const defs = visibleDefinitions.filter((d) => d.category === category);
            if (!defs.length) return null;
            return (
              <div key={category}>
                <div className="section-label mb-1.5">{CATEGORY_LABELS[category]}</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {defs.map((def) => (
                    <button
                      key={def.type}
                      type="button"
                      onClick={() => {
                        addProcessor(scope, trackId, def.type);
                        setAddOpen(false);
                      }}
                      className="focus-ring rounded-xl border border-white/[.08] bg-[#171727] p-3 text-left transition-all duration-180 hover:border-[#A77AFF]/40 hover:bg-[#1D1D30]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-ink-100">{def.name}</span>
                        <Badge tone="neutral">{def.shortName}</Badge>
                      </div>
                      <p className="mt-1 text-2xs leading-relaxed text-ink-400">{def.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 border-t border-ink-700 pt-2 text-2xs leading-relaxed text-ink-500">
          Every processor listed here is implemented in the DSP engine and affects the rendered audio. Adding one never
          resets the rest of the chain.
        </p>
      </Modal>
    </div>
  );
}

function SidechainSelect({ scope, trackId, node }: { scope: ChainScope; trackId: string | null; node: ProcessorNodeState }) {
  const project = useApp((s) => s.project);
  if (!project) return null;
  const otherTracks = project.tracks.filter((t) => t.id !== trackId && t.clips.length > 0);
  return (
    <div className="mt-2 border-t border-ink-700 pt-2">
      <Select
        label="External sidechain key"
        value={node.sidechainFrom ?? ''}
        options={[{ value: '', label: 'Internal (self)' }, ...otherTracks.map((t) => ({ value: t.id, label: t.name }))]}
        onChange={(value) => useApp.getState().setProcessorSidechain(scope, trackId, node.id, value || null)}
      />
      <p className="mt-1 text-2xs text-ink-500">
        The key signal changes what the detector hears, not the audio that is processed.
      </p>
    </div>
  );
}

function ProcessorParams({
  scope,
  trackId,
  node,
  advanced,
}: {
  scope: ChainScope;
  trackId: string | null;
  node: ProcessorNodeState;
  advanced: boolean;
}) {
  const [compressorPreset, setCompressorPreset] = useState('');
  const [multibandPreset, setMultibandPreset] = useState('');
  const [eqPreset, setEqPreset] = useState('');
  const [dynamicEqPreset, setDynamicEqPreset] = useState('');
  const [resonancePreset, setResonancePreset] = useState('');
  const [deEsserPreset, setDeEsserPreset] = useState('');
  const [transientPreset, setTransientPreset] = useState('');
  const [gatePreset, setGatePreset] = useState('');
  const [saturationPreset, setSaturationPreset] = useState('');
  const [exciterPreset, setExciterPreset] = useState('');
  const [clipperPreset, setClipperPreset] = useState('');
  const [limiterPreset, setLimiterPreset] = useState('');
  const [stereoPreset, setStereoPreset] = useState('');
  useEffect(() => { setCompressorPreset(''); setMultibandPreset(''); setEqPreset(''); setDynamicEqPreset(''); setResonancePreset(''); setDeEsserPreset(''); setTransientPreset(''); setGatePreset(''); setSaturationPreset(''); setExciterPreset(''); setClipperPreset(''); setLimiterPreset(''); setStereoPreset(''); }, [node.id]);
  const def = getDefinition(node.type);
  if (!def) return null;
  const groups = new Map<string, ParamSpec[]>();
  for (const spec of def.params) {
    if (spec.advanced && !advanced) continue;
    const group = spec.group ?? 'Parameters';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(spec);
  }
  const update = (key: string, value: number) => {
    if (node.type === 'compressor') setCompressorPreset('');
    if (node.type === 'multibandComp') setMultibandPreset('');
    if (node.type === 'eq') setEqPreset('');
    if (node.type === 'dynamicEq') setDynamicEqPreset('');
    if (node.type === 'resonance') setResonancePreset('');
    if (node.type === 'deesser') setDeEsserPreset('');
    if (node.type === 'transient') setTransientPreset('');
    if (node.type === 'gate') setGatePreset('');
    if (node.type === 'saturation') setSaturationPreset('');
    if (node.type === 'exciter') setExciterPreset('');
    if (node.type === 'clipper') setClipperPreset('');
    if (node.type === 'limiter') setLimiterPreset('');
    if (node.type === 'stereo') setStereoPreset('');
    useApp.getState().updateProcessorParams(scope, trackId, node.id, { [key]: value });
  };
  const applyCompressorPreset = (presetId: string) => {
    const preset = COMPRESSOR_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setCompressorPreset(preset.id);
  };
  const applyMultibandPreset = (presetId: string) => {
    const preset = MULTIBAND_COMP_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setMultibandPreset(preset.id);
  };
  const applyEqPreset = (presetId: string) => {
    const preset = EQ_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setEqPreset(preset.id);
  };
  const applyDynamicEqPreset = (presetId: string) => {
    const preset = DYNAMIC_EQ_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setDynamicEqPreset(preset.id);
  };
  const applyResonancePreset = (presetId: string) => {
    const preset = RESONANCE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setResonancePreset(preset.id);
  };
  const applyDeEsserPreset = (presetId: string) => {
    const preset = DEESSER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setDeEsserPreset(preset.id);
  };
  const applyTransientPreset = (presetId: string) => {
    const preset = TRANSIENT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setTransientPreset(preset.id);
  };
  const applyGatePreset = (presetId: string) => {
    const preset = GATE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setGatePreset(preset.id);
  };
  const applySaturationPreset = (presetId: string) => {
    const preset = SATURATION_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setSaturationPreset(preset.id);
  };
  const applyExciterPreset = (presetId: string) => {
    const preset = EXCITER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setExciterPreset(preset.id);
  };
  const applyClipperPreset = (presetId: string) => {
    const preset = CLIPPER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setClipperPreset(preset.id);
  };
  const applyLimiterPreset = (presetId: string) => {
    const preset = LIMITER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setLimiterPreset(preset.id);
  };
  const applyStereoPreset = (presetId: string) => {
    const preset = STEREO_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    useApp.getState().updateProcessorParams(scope, trackId, node.id, preset.values);
    setStereoPreset(preset.id);
  };
  return (
    <div className="space-y-2">
      {node.type === 'stereo' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Stereo imaging starting point"
            value={stereoPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...STEREO_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyStereoPreset}
          />
          {stereoPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {STEREO_PRESETS.find((preset) => preset.id === stereoPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'limiter' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Limiter starting point"
            value={limiterPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...LIMITER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyLimiterPreset}
          />
          {limiterPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {LIMITER_PRESETS.find((preset) => preset.id === limiterPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'clipper' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Clipper starting point"
            value={clipperPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...CLIPPER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyClipperPreset}
          />
          {clipperPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {CLIPPER_PRESETS.find((preset) => preset.id === clipperPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'exciter' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Exciter starting point"
            value={exciterPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...EXCITER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyExciterPreset}
          />
          {exciterPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {EXCITER_PRESETS.find((preset) => preset.id === exciterPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'saturation' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Saturation starting point"
            value={saturationPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...SATURATION_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applySaturationPreset}
          />
          {saturationPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {SATURATION_PRESETS.find((preset) => preset.id === saturationPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'gate' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Gate / expander starting point"
            value={gatePreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...GATE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyGatePreset}
          />
          {gatePreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {GATE_PRESETS.find((preset) => preset.id === gatePreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'transient' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Transient starting point"
            value={transientPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...TRANSIENT_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyTransientPreset}
          />
          {transientPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {TRANSIENT_PRESETS.find((preset) => preset.id === transientPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'deesser' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="De-esser starting point"
            value={deEsserPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...DEESSER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyDeEsserPreset}
          />
          {deEsserPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {DEESSER_PRESETS.find((preset) => preset.id === deEsserPreset)?.description} All controls remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'resonance' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Resonance starting point"
            value={resonancePreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...RESONANCE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyResonancePreset}
          />
          {resonancePreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {RESONANCE_PRESETS.find((preset) => preset.id === resonancePreset)?.description} All bands remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'dynamicEq' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Dynamic EQ starting point"
            value={dynamicEqPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...DYNAMIC_EQ_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyDynamicEqPreset}
          />
          {dynamicEqPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {DYNAMIC_EQ_PRESETS.find((preset) => preset.id === dynamicEqPreset)?.description} All bands remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'eq' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="EQ starting point"
            value={eqPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...EQ_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyEqPreset}
          />
          {eqPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {EQ_PRESETS.find((preset) => preset.id === eqPreset)?.description} All bands remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'multibandComp' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Multiband starting point"
            value={multibandPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...MULTIBAND_COMP_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyMultibandPreset}
          />
          {multibandPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {MULTIBAND_COMP_PRESETS.find((preset) => preset.id === multibandPreset)?.description} All band settings remain editable.
            </p>
          )}
        </div>
      )}
      {node.type === 'compressor' && (
        <div className="rounded border border-[#A77AFF]/15 bg-[#8957FF]/[.045] p-2.5">
          <Select
            label="Compressor starting point"
            value={compressorPreset}
            options={[{ value: '', label: 'Choose a starting point…' }, ...COMPRESSOR_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))]}
            onChange={applyCompressorPreset}
          />
          {compressorPreset && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {COMPRESSOR_PRESETS.find((preset) => preset.id === compressorPreset)?.description} All parameters remain editable.
            </p>
          )}
        </div>
      )}
      {[...groups.entries()].map(([group, specs], index) => (
        <details key={group} open={index === 0} className="group rounded border border-ink-700/70 bg-ink-900/40">
          <summary className="cursor-pointer list-none px-2 py-1.5 text-2xs uppercase tracking-wider text-ink-400 hover:text-ink-200">
            <span className="mr-1 inline-block text-ink-600 transition-transform group-open:rotate-90">▸</span>
            {group}
            <span className="ml-2 text-ink-600">{specs.length}</span>
          </summary>
          <div className="grid gap-x-3 gap-y-2 px-2 pb-2 sm:grid-cols-2">
            {specs.map((spec) => {
              const value = node.params[spec.key] ?? spec.default;
              if (spec.kind === 'bool') {
                return (
                  <div key={spec.key} className="pt-1">
                    <Toggle checked={value > 0.5} onChange={(next) => update(spec.key, next ? 1 : 0)} label={spec.label} />
                  </div>
                );
              }
              if (spec.kind === 'enum') {
                return (
                  <Select
                    key={spec.key}
                    label={spec.label}
                    value={Math.round(value)}
                    options={(spec.options ?? []).map((option, index) => ({ value: index, label: option }))}
                    onChange={(next) => update(spec.key, next)}
                  />
                );
              }
              return (
                <div key={spec.key} className="min-w-0">
                  <ParamSlider
                    label={spec.label}
                    value={value}
                    min={spec.min ?? 0}
                    max={spec.max ?? 1}
                    step={spec.step ?? 0.01}
                    unit={spec.unit}
                    logarithmic={spec.scale === 'log'}
                    compact
                    onChange={(next) => update(spec.key, clamp(next, spec.min ?? -Infinity, spec.max ?? Infinity))}
                    format={
                      spec.scale === 'log' && (spec.max ?? 0) >= 1000
                        ? (v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)} ${spec.unit ?? ''}`.trim()
                        : undefined
                    }
                  />
                  {node.type === 'compressor' && spec.key === 'link' && (
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
                      0% compresses left and right independently. 100% uses the louder detector for shared stereo gain reduction.
                    </p>
                  )}
                  {node.type === 'multibandComp' && spec.key.endsWith('_link') && (
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
                      0% uses independent left/right detection in this band. 100% applies shared gain reduction to both channels.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
      {!advanced && def.params.some((p) => p.advanced) && (
        <p className="text-2xs text-ink-500">
          {def.params.filter((p) => p.advanced).length} advanced controls are hidden in beginner mode.
        </p>
      )}
    </div>
  );
}

void formatParam;
