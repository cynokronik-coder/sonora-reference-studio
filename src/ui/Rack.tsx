import { useMemo, useState } from 'react';
import type { ProcessorNodeState } from '../audio/model/types';
import { PROCESSOR_DEFINITIONS, getDefinition, formatParam } from '../audio/dsp/registry';
import type { ParamSpec, ProcessorCategory, ProcessorMeterSnapshot } from '../audio/dsp/types';
import { useApp } from '../state/store';
import type { ChainScope } from '../audio/model/project';
import { Badge, Button, HelpTip, IconButton, Modal, ParamSlider, Select, Toggle } from './Primitives';
import { EQCurve, GainReductionMeter } from './viz';
import { clamp } from '../audio/dsp/util';

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
  meters?: ProcessorMeterSnapshot[string];
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
          const reduction = meters?.[node.id]?.reduction ?? 0;
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

                  <ProcessorParams scope={scope} trackId={trackId} node={node} advanced={mode === 'advanced'} />

                  {(node.type === 'compressor' || node.type === 'multibandComp' || node.type === 'deesser' || node.type === 'gate' || node.type === 'limiter') && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-2xs text-ink-500">Gain reduction</span>
                      <GainReductionMeter reductionDb={reduction} height={8} />
                      <span className="font-mono text-2xs text-signal-amber">{reduction > 0.05 ? `-${reduction.toFixed(1)} dB` : '0.0 dB'}</span>
                    </div>
                  )}

                  {node.type === 'gate' && (
                    <div className="mt-1 text-right font-mono text-2xs text-ink-500">
                      L -{(meters?.[node.id]?.reductionL ?? 0).toFixed(1)} dB · R -{(meters?.[node.id]?.reductionR ?? 0).toFixed(1)} dB
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
    useApp.getState().updateProcessorParams(scope, trackId, node.id, { [key]: value });
  };
  return (
    <div className="space-y-2">
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
                <ParamSlider
                  key={spec.key}
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
