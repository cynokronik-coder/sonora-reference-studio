import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, EmptyState, Modal, Panel, Select, Tabs } from '../ui/Primitives';
import type { PresetCategory } from '../audio/presets/library';
import { findTrack } from '../audio/model/project';

export default function Presets() {
  const { presets, project, selectedTrackId, applyPreset, savePreset, deleteUserPreset } = useApp();
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<'master' | 'track'>(selectedTrackId ? 'track' : 'master');
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const track = project ? findTrack(project, selectedTrackId) : undefined;
  const filtered = useMemo(
    () =>
      presets.filter(
        (preset) =>
          (category === 'all' || preset.category === category) &&
          (!search.trim() || preset.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [presets, category, search],
  );

  if (!project) {
    return <div className="p-5"><Panel><EmptyState title="No project open" description="Open a project to browse and apply presets." /></Panel></div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5 sm:p-6 lg:p-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Library</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-100">Presets</h1>
          <p className="mt-1 text-xs text-ink-400">
            Starting points, not universal solutions. Loading one replaces the target chain with fully editable processors.
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            label="Apply to"
            value={target}
            options={[{ value: 'master', label: 'Master chain' }, { value: 'track', label: track ? track.name : 'Selected track (none)' }]}
            onChange={(value) => setTarget(value as 'master' | 'track')}
          />
          <Button onClick={() => setSaveOpen(true)}>Save current chain</Button>
        </div>
      </header>

      <div data-tour="presets-filters" className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={category}
          onChange={setCategory}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'vocal', label: 'Vocal' },
            { value: 'mix', label: 'Mix' },
            { value: 'mastering', label: 'Mastering' },
          ]}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search presets…"
          className="focus-ring rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500"
        />
      </div>

      <div data-tour="presets-list" className="grid gap-3 md:grid-cols-2">
        {filtered.map((preset) => (
          <Panel key={preset.id} title={preset.name} right={<Badge tone={preset.builtIn ? 'neutral' : 'accent'}>{preset.builtIn ? preset.category : 'user'}</Badge>}>
            <p className="text-2xs leading-relaxed text-ink-400">{preset.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {preset.processors.map((processor, index) => (
                <span key={`${processor.type}-${index}`} className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 font-mono text-2xs text-ink-300">
                  {processor.type}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                disabled={target === 'track' && !track}
                onClick={() => applyPreset(preset.id, target, target === 'track' ? selectedTrackId : null)}
              >
                Load {target === 'track' ? 'to track' : 'to master'}
              </Button>
              {!preset.builtIn && (
                <Button size="sm" variant="ghost" onClick={() => void deleteUserPreset(preset.id)}>
                  Delete
                </Button>
              )}
            </div>
          </Panel>
        ))}
      </div>
      {filtered.length === 0 && <p className="text-xs text-ink-500">No presets match that filter.</p>}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save current chain as a preset">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-2xs text-ink-400">Name</span>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="My vocal chain"
              className="focus-ring w-full rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </label>
          <p className="text-2xs leading-relaxed text-ink-500">
            Saves the {target === 'track' && track ? `"${track.name}"` : 'master'} chain with every current parameter.
            Personal presets are stored locally.
          </p>
          <Button
            variant="primary"
            disabled={!presetName.trim() || (target === 'track' && !track)}
            onClick={async () => {
              await savePreset(presetName.trim(), target === 'master' ? 'mastering' : 'mix', `Saved from ${target === 'master' ? 'master' : track?.name ?? 'track'} chain.`, target, target === 'track' ? selectedTrackId : null);
              setSaveOpen(false);
              setPresetName('');
            }}
          >
            Save preset
          </Button>
        </div>
      </Modal>
    </div>
  );
}
