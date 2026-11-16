import { createDefaultParams, findParam, formatParam } from '../dsp/registry';
import type { ParamValues } from '../dsp/types';
import { clamp } from '../dsp/util';
import type { ProcessorNodeState, TrackState } from '../model/types';
import { uid } from '../model/defaults';
import { currentProcessorStateVersion } from '../model/migrations';

export type AssistantOperationKind = 'add' | 'update' | 'remove' | 'bypass' | 'enable' | 'reference-match';

export interface AssistantOperation {
  kind: AssistantOperationKind;
  scope: 'master' | 'track' | 'bus';
  trackId?: string;
  processorType?: string;
  processorId?: string;
  params?: ParamValues;
  /** Values before this operation, used to scale conversational follow-ups. */
  base?: ParamValues;
  note: string;
  /** Suggested display name for a newly added processor. */
  label?: string;
}

export interface AssistantProposal {
  id: string;
  message: string;
  explanation: string[];
  operations: AssistantOperation[];
  requiresReference: boolean;
  confidence: number;
  contextEcho?: string;
  /** Multiplier applied to numeric parameter deltas when accepted. */
  scale?: number;
}

export interface AssistantScopeContext {
  scope: 'master' | 'track' | 'bus';
  trackId?: string;
  trackName?: string;
  trackKind?: string;
  processors: ProcessorNodeState[];
  hasReference: boolean;
  multiTrack: boolean;
}

const NUMERIC = /(\d+(?:\.\d+)?)/;

export function scaleFactor(text: string): number {
  const lower = text.toLowerCase();
  if (/(slightly|subtle|a little|a bit|gently|small|minor)/.test(lower)) return 0.5;
  if (/(a lot|much|strong|dramatic|heavily|aggressive)/.test(lower)) return 1.7;
  if (/(very|really|extremely)/.test(lower)) return 1.4;
  return 1;
}

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function findProcessor(processors: ProcessorNodeState[], type: string): ProcessorNodeState | undefined {
  return processors.find((p) => p.type === type);
}

function ensureProcessor(
  processors: ProcessorNodeState[],
  type: string,
  ops: AssistantOperation[],
  scope: AssistantScopeContext,
  note: string,
  label: string,
): ProcessorNodeState {
  const existing = findProcessor(processors, type);
  if (existing) {
    ops.push({
      kind: 'update',
      scope: scope.scope,
      trackId: scope.trackId,
      processorId: existing.id,
      processorType: existing.type,
      note,
      label,
    });
    return existing;
  }
  const created: ProcessorNodeState = {
    id: uid('proc'),
    type,
    version: currentProcessorStateVersion(type),
    enabled: true,
    params: createDefaultParams(type),
  };
  processors.push(created);
  ops.push({
    kind: 'add',
    scope: scope.scope,
    trackId: scope.trackId,
    processorId: created.id,
    processorType: type,
    params: { ...created.params },
    base: createDefaultParams(type),
    note,
    label,
  });
  return created;
}

function setParams(ops: AssistantOperation[], node: ProcessorNodeState, params: ParamValues, note: string): void {
  const base = { ...node.params };
  const merged = { ...node.params, ...params };
  node.params = merged;
  ops.push({
    kind: 'update',
    scope: 'master',
    processorId: node.id,
    processorType: node.type,
    params: merged,
    base,
    note,
  });
}

function describe(type: string, key: string, value: number): string {
  const spec = findParam(type, key);
  return spec ? `${spec.label} ${formatParam(spec, value)}` : `${key} ${value}`;
}

function parseFrequency(text: string): number | null {
  const khz = text.match(/(\d+(?:\.\d+)?)\s*k(?:hz)?/);
  if (khz) return Math.round(parseFloat(khz[1]) * 1000);
  const hz = text.match(/(\d{2,5})\s*(?:hz)/);
  if (hz) return parseInt(hz[1], 10);
  return null;
}

function parseDb(text: string): number | null {
  const m = text.match(/([+-]?\d+(?:\.\d+)?)\s*db/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Deterministic intent interpreter.
 *
 * This is the assistant's brain when no external model is configured. It
 * understands a bounded but genuinely useful vocabulary of mixing requests,
 * always edits an existing processor before adding a duplicate, and returns a
 * previewable operation list rather than mutating the project.
 */
export function interpretCommand(command: string, context: AssistantScopeContext, previous?: AssistantProposal | null): AssistantProposal {
  const text = command.toLowerCase().trim();
  const factor = scaleFactor(text);
  const ops: AssistantOperation[] = [];
  const explanation: string[] = [];
  const processors = context.processors.map((p) => ({ ...p, params: { ...p.params } }));
  const scope = context.scope;

  // Conversational adjustment of the previous proposal.
  if (/^(that'?s|that is|too much|too strong|less|reduce that|calm)/.test(text) && previous?.operations.length) {
    return scalePrevious(previous, 0.55, 'Reduced the last adjustment and kept the rest of the chain intact.');
  }
  if (/^(more|stronger|increase that|push it)/.test(text) && previous?.operations.length) {
    return scalePrevious(previous, 1.35, 'Increased the last adjustment.');
  }

  // Removal / bypass requests take priority and must not reset other settings.
  const removal = text.match(/(remove|delete|drop|bypass|take out|turn off)\s+(?:the\s+)?([a-z0-9 -]+)/);
  if (removal) {
    const target = removal[2];
    let type: string | null = null;
    if (/excit/.test(target)) type = 'exciter';
    else if (/de-?ess/.test(target)) type = 'deesser';
    else if (/eq|equal/.test(target)) type = 'eq';
    else if (/comp/.test(target)) type = 'compressor';
    else if (/limit/.test(target)) type = 'limiter';
    else if (/sat/.test(target)) type = 'saturation';
    else if (/reverb|verb/.test(target)) type = 'reverb';
    else if (/delay/.test(target)) type = 'delay';
    else if (/stereo|width/.test(target)) type = 'stereo';
    else if (/transient/.test(target)) type = 'transient';
    const node = type ? findProcessor(processors, type) : undefined;
    if (node) {
      ops.push({
        kind: /bypass|turn off/.test(removal[1]) ? 'bypass' : 'remove',
        scope,
        trackId: context.trackId,
        processorId: node.id,
        processorType: node.type,
        note: `${/bypass/.test(removal[1]) ? 'Bypassed' : 'Removed'} ${type}. Other processors are untouched.`,
      });
      return {
        id: uid('asst'),
        message: `${/bypass/.test(removal[1]) ? 'Bypassed' : 'Removed'} the ${type}. Everything else in the chain stays as it is.`,
        explanation: [`Found an existing ${type} in the ${describeScope(context)} and left its neighbours untouched.`],
        operations: ops,
        requiresReference: false,
        confidence: 0.96,
      };
    }
    return {
      id: uid('asst'),
      message: `There is no ${target} on the ${describeScope(context)}.`,
      explanation: ['Nothing was changed. Ask me to add one first if you want it in the chain.'],
      operations: [],
      requiresReference: false,
      confidence: 0.9,
    };
  }

  const wantsReference = /reference|closer to the (song|track)|match the (song|track)/.test(text);
  if (wantsReference) {
    return {
      id: uid('asst'),
      message: context.hasReference
        ? 'I can rebuild the chain from your analysed reference. Open Reference Match Studio to control intensity and categories, or apply the generated plan to this chain.'
        : 'No reference has been analysed yet. Upload one in Reference Match Studio and I can generate a matching chain.',
      explanation: [
        'Reference matching is driven by measured differences, not by the assistant inventing values.',
        context.hasReference ? 'Your saved match plan can be applied here.' : 'Upload a commercial release to use as the sonic target.',
      ],
      operations: [],
      requiresReference: context.hasReference,
      confidence: 0.9,
    };
  }

  if (!context.multiTrack && scope === 'master') {
    explanation.push('This is a stereo project: the assistant can only shape the combined mix, not isolated vocals or drums.');
  }

  // Harshness / sibilance.
  if (has(text, ['harsh', 'harshness', 'piercing', 'ear fatigue', 'harsh upper mid'])) {
    const eq = ensureProcessor(processors, 'eq', ops, context, 'Notch harsh upper mids', 'EQ');
    const freq = parseFrequency(text) ?? 3200;
    const gain = clamp(-3.5 * factor, -12, -0.5);
    setParams(ops, eq, {
      b1_on: 1, b1_type: 0, b1_freq: freq, b1_gain: Number(gain.toFixed(1)), b1_q: 1.1, b1_route: 0,
    }, `Cut ${Math.abs(gain).toFixed(1)} dB at ${freq} Hz`);
    explanation.push(`A focused bell cut at ${freq} Hz reduces harshness without dulling the whole top end.`);
    if (has(text, ['sss', 'sibil', 'ess'])) {
      const de = ensureProcessor(processors, 'deesser', ops, context, 'Control sibilance', 'De-esser');
      setParams(ops, de, { frequency: 6500, threshold: -30, range: clamp(7 * factor, 2, 14) }, 'De-esser engaged');
      explanation.push('The de-esser works only on the sibilance band, so it will not lisp or dull the vocal.');
    }
  }

  // Brightness / air / clarity / presence.
  if (has(text, ['brighter', 'bright', 'air', 'airy', 'sparkle', 'crisp', 'open', 'clarity', 'clear'])) {
    const eq = ensureProcessor(processors, 'eq', ops, context, 'Add presence and air', 'EQ');
    const shelf = clamp(2.2 * factor, 0.5, 7);
    const presence = clamp(1.6 * factor, 0.4, 5);
    setParams(ops, eq, {
      b2_on: 1, b2_type: 2, b2_freq: 9000, b2_gain: Number(shelf.toFixed(1)), b2_q: 0.7,
      b3_on: 1, b3_type: 0, b3_freq: 3500, b3_gain: Number(presence.toFixed(1)), b3_q: 1.0,
    }, `High shelf +${shelf.toFixed(1)} dB, presence +${presence.toFixed(1)} dB`);
    explanation.push('A shelf above 9 kHz adds air; the 3.5 kHz bell adds intelligibility. Both are gentle enough to avoid harshness.');
    if (has(text, ['without', 'not harsh', 'no harsh'])) {
      setParams(ops, eq, { b1_on: 1, b1_type: 0, b1_freq: 3200, b1_gain: -1.5, b1_q: 1.2 }, 'Small 3.2 kHz cut to offset harshness');
      explanation.push('A small 3.2 kHz cut compensates so the added presence does not tip into harshness.');
    }
  }

  // Warmth / darkness.
  if (has(text, ['warmer', 'warm', 'analog', 'analogue', 'body', 'fuller', 'rich'])) {
    const eq = ensureProcessor(processors, 'eq', ops, context, 'Add warmth', 'EQ');
    const gain = clamp(1.8 * factor, 0.5, 5);
    setParams(ops, eq, {
      b0_on: 1, b0_type: 1, b0_freq: 180, b0_gain: Number(gain.toFixed(1)), b0_q: 0.7,
      b4_on: 1, b4_type: 0, b4_freq: 250, b4_gain: Number((gain * 0.6).toFixed(1)), b4_q: 1.1,
    }, `Low shelf +${gain.toFixed(1)} dB at 180 Hz`);
    explanation.push('A low shelf adds weight while the 250 Hz bell restores body without making the mix boomy.');
    explanation.push('Warmth is fundamentally harmonic: a small tape-style saturation stage can help, but it is not added automatically to keep the change reversible and clean.');
  }

  // Mud / boxiness / low-mid buildup.
  if (has(text, ['muddy', 'mud', 'boxy', 'cloudy', 'clutter', 'muffled'])) {
    const eq = ensureProcessor(processors, 'eq', ops, context, 'Clear low-mid buildup', 'EQ');
    const freq = parseFrequency(text) ?? 300;
    const gain = clamp(-3.2 * factor, -10, -1);
    setParams(ops, eq, {
      b0_on: 1, b0_type: 0, b0_freq: freq, b0_gain: Number((gain / 2).toFixed(1)), b0_q: 0.9,
      b5_on: 1, b5_type: 0, b5_freq: 420, b5_gain: Number(gain.toFixed(1)), b5_q: 1.0,
    }, `Cut ${Math.abs(gain).toFixed(1)} dB around ${freq} Hz`);
    explanation.push('The 200–500 Hz range is the usual source of mud. Two overlapping cuts broaden the correction without hollowing the voice.');
    const node = findProcessor(processors, 'dynamicEq');
    if (!node) {
      explanation.push('Consider a Dynamic EQ if the buildup only happens on certain notes.');
    }
  }

  // Bass / low end.
  if (has(text, ['bass', 'low end', 'low-end', 'sub', 'kick'])) {
    if (has(text, ['tight', 'tighter', 'control', 'controlled', 'less boomy', 'clean'])) {
      const eq = ensureProcessor(processors, 'eq', ops, context, 'Tighten low end', 'EQ');
      setParams(ops, eq, {
        b0_on: 1, b0_type: 0, b0_freq: 60, b0_gain: 1.2, b0_q: 1.0,
        b5_on: 1, b5_type: 0, b5_freq: 220, b5_gain: -2.8, b5_q: 1.1,
      }, 'Sub +1.2 dB, low-mid -2.8 dB');
      const comp = ensureProcessor(processors, 'compressor', ops, context, 'Control low-end movement', 'Compressor');
      setParams(ops, comp, { threshold: -22, ratio: 2.6, attack: 25, release: 180, scHpf: 150, mix: 45 }, 'Slow compression, 45% mix');
      explanation.push('Tightening comes from controlling the 200 Hz buildup and slow low-end movement, not from simply boosting sub.');
    } else if (has(text, ['more', 'increase', 'add', 'bigger', 'heavier'])) {
      const eq = ensureProcessor(processors, 'eq', ops, context, 'Add low-end weight', 'EQ');
      setParams(ops, eq, { b0_on: 1, b0_type: 1, b0_freq: 90, b0_gain: clamp(2.5 * factor, 0.5, 6) }, 'Low shelf boost');
      explanation.push('A shelf below 120 Hz adds weight while leaving the 300 Hz mud zone alone.');
    }
  }

  // Punch / drums / transients.
  if (has(text, ['punch', 'punchy', 'drums', 'hit', 'slam', 'attack'])) {
    const tr = ensureProcessor(processors, 'transient', ops, context, 'Increase transient attack', 'Transient Shaper');
    setParams(ops, tr, { attack: clamp(35 * factor, 8, 80), sustain: clamp(-8 * factor, -25, 0), mix: 70, sensitivity: 55 }, 'Attack up, sustain slightly down');
    explanation.push('The transient shaper increases the leading edge so drums hit harder without raising the overall level.');
    if (has(text, ['kick', 'low end', 'thump'])) {
      const eq = ensureProcessor(processors, 'eq', ops, context, 'Kick emphasis', 'EQ');
      setParams(ops, eq, { b0_on: 1, b0_type: 0, b0_freq: 70, b0_gain: clamp(2 * factor, 0.5, 5), b0_q: 1.2 }, '70 Hz kick emphasis');
      explanation.push('A narrow 70 Hz lift adds thump; keep it under +4 dB to avoid eating headroom.');
    }
  }

  // Stereo width / depth.
  if (has(text, ['wide', 'wider', 'width', 'stereo image', 'spacious'])) {
    const st = ensureProcessor(processors, 'stereo', ops, context, 'Widen stereo image', 'Stereo Imaging');
    const width = clamp(100 + 28 * factor, 105, 155);
    setParams(ops, st, { width, lowWidth: 0, highWidth: 100, split: 180, monoMaker: 1 }, `Width ${width.toFixed(0)}%, bass mono below 180 Hz`);
    explanation.push('Widening is applied to the side signal above 180 Hz so the bass stays mono and the mix survives mono playback.');
    if (has(text, ['mono', 'safe'])) {
      explanation.push('Mono compatibility is a measured property; check the analysis panel after applying.');
    }
  }

  if (has(text, ['depth', 'deep', 'space', 'ambien'])) {
    const rv = ensureProcessor(processors, 'reverb', ops, context, 'Add depth', 'Reverb');
    setParams(ops, rv, { style: 1, predelay: 24, decay: 2.2, damping: 0.4, mix: clamp(10 * factor, 6, 22), width: 100 }, `Hall reverb at ${clamp(10 * factor, 6, 22).toFixed(0)}% wet`);
    explanation.push('A short predelay keeps the source upfront while the tail adds depth. On a stereo master this affects the whole mix, not just vocals.');
  }

  // Compression / dynamics.
  if (has(text, ['compress', 'compression', 'density', 'glue', 'tighter dynamics'])) {
    if (has(text, ['reduce', 'less', 'too much', 'over', 'stop'])) {
      const nodes = processors.filter((p) => p.type === 'compressor' || p.type === 'multibandComp');
      if (nodes.length) {
        for (const node of nodes) {
          const ratio = node.type === 'compressor' ? node.params.ratio ?? 3 : 2;
          ops.push({
            kind: 'update', scope, trackId: context.trackId, processorId: node.id, processorType: node.type,
            params: { ...node.params, ratio: Math.max(1, ratio * 0.7), mix: Math.max(20, (node.params.mix ?? 100) * 0.8) },
            note: 'Reduced ratio and wet mix',
          });
        }
        explanation.push('Reducing the existing compressor is safer than adding an expander, which cannot restore lost transients.');
      } else {
        explanation.push('There is no compressor on this chain, so there is nothing to reduce. If the source itself is over-compressed, that cannot be undone.');
      }
    } else {
      const comp = ensureProcessor(processors, 'compressor', ops, context, 'Add bus glue', 'Compressor');
      setParams(ops, comp, {
        threshold: -20, ratio: clamp(2 * factor, 1.4, 3.2), attack: 28, release: 200, knee: 8,
        style: 4, mix: 60, scHpf: 140, makeup: 0,
      }, 'Slow bus compression at 60% wet');
      explanation.push('Slow attack and release let transients through while the sustained level becomes more cohesive.');
    }
  }

  // Loudness.
  if (has(text, ['louder', 'loud', 'volume', 'level up', 'raise the level'])) {
    const limiter = ensureProcessor(processors, 'limiter', ops, context, 'Raise output level safely', 'Limiter');
    const drive = clamp(2 * factor, 0.5, 6);
    setParams(ops, limiter, {
      input: drive, ceiling: -1, truePeak: 1, release: 90, lookahead: 4,
    }, `+${drive.toFixed(1)} dB into a -1 dBTP limiter`);
    explanation.push(
      has(text, ['without distortion', 'clean', 'no distortion'])
        ? 'The true-peak limiter catches inter-sample peaks and the 4 ms lookahead prevents hard clipping.'
        : 'The limiter is the last stage; pushing more than a few dB into it trades transient life for level.',
    );
  }

  // Vocals.
  if (has(text, ['vocal', 'vox', 'voice', 'singer'])) {
    if (has(text, ['sit', 'balance', 'instrumental', 'too loud', 'too quiet', 'bury', 'behind'])) {
      const eq = ensureProcessor(processors, 'eq', ops, context, 'Carve space for vocals', 'EQ');
      setParams(ops, eq, {
        b3_on: 1, b3_type: 0, b3_freq: 2800, b3_gain: 2.2, b3_q: 1.0,
        b5_on: 1, b5_type: 0, b5_freq: 350, b5_gain: -1.5, b5_q: 1.0,
      }, 'Vocal presence +2.2 dB, low-mid -1.5 dB');
      const comp = ensureProcessor(processors, 'compressor', ops, context, 'Stabilise vocal level', 'Compressor');
      setParams(ops, comp, { threshold: -24, ratio: 2.4, attack: 12, release: 120, mix: 100 }, 'Vocal compression');
      explanation.push('Presence and low-mid control help a vocal sit forward without simply raising its fader.');
    }
  }

  // If nothing matched, respond honestly.
  if (!ops.length) {
    return {
      id: uid('asst'),
      message:
        'I can adjust EQ, compression, saturation, stereo width, transients, de-essing and limiting, but I did not recognise a concrete request in that phrase.',
      explanation: [
        'Try: "reduce the muddy frequencies", "make the vocals clearer without making them harsh", "give the drums more punch", "make the master wider", or "remove the exciter".',
        'All suggestions are previewed and remain fully editable.',
      ],
      operations: [],
      requiresReference: false,
      confidence: 0.2,
    };
  }

  const summary = ops
    .map((op) => {
      if (op.kind === 'add') return `add ${op.processorType}`;
      if (op.kind === 'remove') return `remove ${op.processorType}`;
      if (op.kind === 'bypass') return `bypass ${op.processorType}`;
      const p = op.params ?? {};
      const changed = Object.entries(p).slice(0, 3).map(([k, v]) => describe(op.processorType ?? '', k, v));
      return `${op.processorType}: ${changed.join(', ')}`;
    })
    .join('; ');

  return {
    id: uid('asst'),
    message: `Here is a preview of the changes for the ${describeScope(context)}. Nothing has been applied yet.`,
    explanation: [...explanation, `Preview: ${summary}.`],
    operations: ops,
    requiresReference: false,
    confidence: 0.78,
  };
}

function describeScope(context: AssistantScopeContext): string {
  if (context.scope === 'master') return 'master chain';
  return context.trackName ? `track "${context.trackName}"` : 'selected track';
}

function scalePrevious(previous: AssistantProposal, factor: number, message: string): AssistantProposal {
  const operations = previous.operations.map((op) => ({
    ...op,
    note: `${op.note} (${factor < 1 ? 'scaled back' : 'increased'})`,
  }));
  return {
    id: uid('asst'),
    message,
    explanation: [
      factor < 1
        ? 'I kept the same processors and scaled the numeric changes back instead of resetting the chain.'
        : 'I increased the most recent numeric changes while preserving the rest of the chain.',
    ],
    operations,
    requiresReference: false,
    confidence: previous.confidence,
    contextEcho: previous.id,
    scale: factor,
  };
}

/** Suggest follow-up questions based on the current chain. */
export function suggestionsFor(processors: ProcessorNodeState[], isStereo: boolean): string[] {
  const ideas = [
    'Make the vocals clearer without making them harsh',
    'Reduce the muddy frequencies',
    'Give the drums more punch',
    'Make the master sound wider',
  ];
  if (!processors.some((p) => p.type === 'limiter')) ideas.push('Make the master louder without excessive distortion');
  if (processors.some((p) => p.type === 'saturation')) ideas.push('Remove the exciter');
  if (isStereo) ideas.push('Make the bass tighter');
  return ideas.slice(0, 5);
}

void NUMERIC;
