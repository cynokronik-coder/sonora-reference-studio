# Development

## Requirements

- Node 20+ (developed on Node 26)
- npm 10+
- A modern Chromium/Firefox/Safari with AudioWorklet and IndexedDB

## Setup

```bash
npm install
npm run dev        # Vite dev server on 0.0.0.0:3000
npm test           # vitest (DSP/analysis/containers)
npm run build      # tsc -b + vite build
npm run typecheck  # explicit typecheck
```

No environment variables are required. No service keys are used by this build.

## Layout

```
src/
  audio/
    dsp/            processors, biquads, FFT, convolution, oversampling, chain
    analysis/       loudness, spectrum, stereo, rhythm, match, workers
    engine/         shared renderer, realtime host, AudioWorklet, offline worker
    io/             decoding, WAV/AIFF encoding and parsing
    model/          project types, defaults, lookup helpers
    presets/        built-in library
    ai/             deterministic assistant
  state/store.ts    application state and orchestration
  lib/              IndexedDB, peak computation
  screens/          one component per primary workspace
  ui/               primitives, rack, mixer, visualizations
```

## Adding an audio processor

1. Implement `AudioProcessor` in `src/audio/dsp/processors/`.
   - `prepare(sampleRate, maxBlock)`
   - `setValues(params)`
   - `process(L, R, n)`
   - `reset()`, `meter()`, `latency`.
2. Declare a `ProcessorDefinition` with parameter specs (min/max/default/unit/group/advanced/log scale).
3. Register in `PROCESSOR_DEFINITIONS` (`registry.ts`).
4. Add a synthetic-signal test proving the processor changes audio as intended.

The rack, automation, presets, matching proposals and export pipeline pick it up automatically. Do not add UI-only
controls: if a parameter exists it must reach `setValues` and the DSP.

## Extending the match engine

`generateMatchPlan` emits `MatchProposal`s. To add a characteristic:

1. Add it to `CategorySource`, `MatchSettings`, `effectiveScales` and `MATCH_CATEGORIES`.
2. Measure it in the analysis layer (never estimate it in the decision layer).
3. Add a decision branch that computes parameters from the measured delta and user limits.
4. Return a proposal with reason, expected result, confidence and before/after values.
5. Add a UI slider and, if multiple references are supported, a category source selector.

The engine must never invent a measurement. If the metric is unavailable, emit a warning or skip the proposal.

## Persistence

IndexedDB schema is in `src/lib/db.ts`. Store only metadata and blobs there; never embed audio samples in project JSON.
Autosave is debounced; `Save now` forces a write. Undo history is in memory and capped at 50 snapshots.

## Known implementation notes

- Because assets are kept for waveform display and analysis, a session holds decoded PCM in memory in addition to the
  worklet/worker copies. Large stem sessions should be split.
- Reopening a project re-decodes original blobs; this is intentional (originals are preserved) but takes time for long
  files.
- The realtime host and offline worker both use copies of PCM; transferring the main-thread buffers would break analysis
  and waveform rendering.
- The assistant is deterministic. Any future LLM integration must validate against the processor registry and must never
  produce measurements.
