/**
 * Level matching for stored mastering audition snapshots.
 *
 * The quietest measured version is the shared reference. Every other slot is
 * attenuated down to that loudness, never boosted, so comparison gain cannot
 * add monitor-bus headroom demand or alter the rendered master.
 */
export interface LoudnessSlotLike {
  id: string;
  lufs: number | null;
  stale?: boolean;
}

export function loudnessMatchedMonitorGain(
  slots: LoudnessSlotLike[],
  selectedSlotId: string | null,
  maxAttenuationDb = 24,
): number {
  if (!selectedSlotId || !Number.isFinite(maxAttenuationDb) || maxAttenuationDb <= 0) return 0;
  const selected = slots.find((slot) => slot.id === selectedSlotId);
  if (!selected || selected.stale || selected.lufs === null || !Number.isFinite(selected.lufs)) return 0;

  const measured = slots
    .filter((slot) => !slot.stale)
    .map((slot) => slot.lufs)
    .filter((lufs): lufs is number => lufs !== null && Number.isFinite(lufs));
  if (!measured.length) return 0;

  const anchorLufs = Math.min(...measured);
  return Math.max(-maxAttenuationDb, Math.min(0, anchorLufs - selected.lufs));
}
