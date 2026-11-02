import type { AutomationLane, AutomationPoint } from '../model/types';

/**
 * Evaluate an automation lane at a point in time. Points are sorted by time;
 * curves are linear or exponential, with exponential never crossing zero to
 * avoid NaN values in gain lanes.
 */
export function valueAtTime(points: AutomationPoint[], time: number, fallback: number): number {
  if (!points.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-9, b.time - a.time);
      const t = (time - a.time) / span;
      if (a.curve === 1) {
        const from = Math.max(1e-6, a.value);
        const to = Math.max(1e-6, b.value);
        return from * Math.pow(to / from, t);
      }
      return a.value + (b.value - a.value) * t;
    }
  }
  return points[points.length - 1].value;
}

export function findLane(
  lanes: AutomationLane[],
  target: AutomationLane['target'],
  opts: { processorId?: string; param?: string; busId?: string } = {},
): AutomationLane | undefined {
  return lanes.find(
    (l) =>
      l.enabled &&
      l.target === target &&
      (opts.processorId ? l.processorId === opts.processorId : true) &&
      (opts.param ? l.param === opts.param : true) &&
      (opts.busId ? l.busId === opts.busId : true),
  );
}

export function sortPoints(points: AutomationPoint[]): AutomationPoint[] {
  return [...points].sort((a, b) => a.time - b.time);
}

/** Adds a point, replacing any point within `epsilon` seconds of it. */
export function upsertPoint(points: AutomationPoint[], point: AutomationPoint, epsilon = 0.02): AutomationPoint[] {
  const filtered = points.filter((p) => Math.abs(p.time - point.time) > epsilon);
  return sortPoints([...filtered, point]);
}
