# Development

## Requirements

- Node 20+ (developed on Node 26)
- npm 10+
- A modern Chromium/Firefox/Safari with AudioWorklet and IndexedDB

## Setup

```bash
npm install
npm run dev        # Vite on :3000 plus the local AI API on 127.0.0.1:8787
npm run dev:ui     # Vite only (AI API unavailable)
npm run dev:api    # Local AI API only
npm start          # Serve dist/ and the API after a production build
npm test           # vitest (DSP/analysis/containers)
npm run build      # tsc -b + vite build
npm run typecheck  # explicit typecheck
```

## Optional AI assistant setup

The rule-based assistant works offline. To enable the real OpenAI-powered assistant locally:

1. Copy `.env.example` to `.env.local`.
2. Add your API key to `OPENAI_API_KEY`.
3. Keep the key server-side. Do not use a `VITE_...` variable and never commit `.env.local`.
4. Optionally change `SONORA_AI_MODEL` to a model available to your OpenAI API project.
5. Run `npm run dev` and open the Vite app on port 3000.

The browser calls the same-origin `/api` proxy. The Node server binds to localhost by default and holds the API key. `GET /api/health` reports whether a key is configured, without returning it.

The AI receives a compact project snapshot: track and processor metadata, available DSP parameter ranges, and computed analysis summaries. It does not receive raw PCM audio. When measurements are missing, it can request the browser's existing local analysis pipeline.

AI processor changes are returned as proposals. The browser validates processor types, parameter keys, IDs and value ranges against the live DSP registry. The user must explicitly accept a proposal before project state changes. If the backend is unavailable or no key is configured, the deterministic offline assistant remains available.

**Deployment note:** this first backend is intended for local development and private testing. It binds to loopback by default. Do not expose it on a public network or deploy it as a shared service until authentication, per-user quotas, persistent rate limiting and abuse monitoring are added. The API key must remain server-side.

No service key is required for the offline assistant.

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
    ai/             Responses API client, context, proposal validation and offline assistant
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
- The assistant supports an optional server-side OpenAI Responses API integration and a deterministic offline fallback.
  Every generated operation is validated against the live processor registry. The model receives computed measurements,
  never raw PCM, and must never invent analysis values.
