# Architecture

## Goals

1. One DSP implementation shared by monitoring and export so what you hear is what renders.
2. Analysis that is deterministic and independent of any AI service.
3. Reference matching as a decision layer that emits editable processor configuration, never audio.
4. A modular processor registry so new processors require no UI or engine rewrite.

## Layers

```
React screens / components
        │  reads / dispatches
        ▼
Zustand store (src/state/store.ts)
        │  project snapshots, undo/redo, autosave
        ├──────────────► IndexedDB (src/lib/db.ts)
        │
        ├──────────────► RealtimeHost ──► AudioWorklet ──► ProjectRenderer ──► speakers
        │
        └──────────────► Offline Worker ──► ProjectRenderer ──► Float32 buffers ──► encoder ──► download

Analysis Worker ──► analyzeAudio() ──► AnalysisReport (JSON)
Match engine ──► generateMatchPlan() ──► MatchPlan ──► ProcessorNodeState[]
```

### Data vs audio
- **Project state** is small, serializable JSON: tracks, clips (references to asset ids), processors, parameters,
  automation, match settings, targets, notes, masters.
- **Audio assets** are blobs in IndexedDB plus decoded `Float32Array` buffers in memory for the session.
- No PCM is stored inside database records.

## Audio engine

`ProjectRenderer` (src/audio/engine/renderer.ts) is the single source of truth for signal flow:

```
clip audio → track chain → latency compensation → pre-fader sends → fader/pan
           → post-fader sends → bus / master → bus chain → master chain → output
```

- **Tracks** hold clips. Clip gain and fades are applied while filling the block.
- **ProcessorChain** reconciles declarative processor configs against live instances by id. Parameters update in place;
  removed processors are disposed; order changes do not reset filter state.
- **Solo/mute/polarity/mono** are applied in the graph, not in the UI.
- **Sends** support pre- and post-fader routing. **External sidechain** keys come from another track's pre-chain audio.
- **Buses** receive direct outputs and sends, process their own chain, and sum into master. One level of bus nesting is
  not supported.
- **Master chain** processes the summed mix, then master gain.

### Realtime vs offline
- Realtime: `engine.worklet.ts` hosts the renderer inside an `AudioWorkletProcessor`, rendering 128-frame quanta. Project
  updates arrive as JSON and are reconciled by processor id. The worklet receives PCM once per asset via transferable
  buffers.
- Offline: `offline.worker.ts` instantiates the same renderer with 512-frame blocks, renders the requested range, and
  measures the result before returning buffers. Progress and cancellation are supported.
- Both use the same `ProjectRenderer` and the same processor classes. There is no separate “preview approximation”.

### Latency
- Linear-phase EQ introduces 256 samples (about 5.3 ms at 48 kHz). Every other processor is zero-latency.
- The renderer computes each track and bus path's latency and inserts compensating integer delay lines so all paths
  reach the master aligned. Direct-to-master tracks absorb the maximum bus latency.
- `renderer.totalLatency` is the exact delay applied by the graph. The offline worker renders that many extra frames and
  discards the head, aligning the file with the timeline. Realtime monitoring is delayed by this small, uniform amount.

## Analysis

`analyzeAudio` runs in a worker and returns a plain JSON report:

- `loudness`: K-weighting, 400 ms blocks at 100 ms hops, BS.1770 gating, LRA, sample and 4x true peak, RMS/crest/PLR.
- `spectrum`: 4096-point Hann FFT frames at 50% overlap, per-band power, centroid, roll-off, tilt, flatness, resonance
  and buildup detection.
- `stereo`: global and per-band mid/side energy, complex-spectrum correlation, short-window mono-cancellation score.
- `rhythm`: spectral-flux onset envelope, tempo autocorrelation, punch/onset metrics, novelty-based sections.
- `sections`: per-section loudness, crest, width, correlation, spectrum and heuristic labels.

Analysis is optical/loudness measurement only; it never writes audio.

## Decision layer (reference matching)

`generateMatchPlan` (src/audio/analysis/match.ts) combines the target and selected reference measurements:

- Tonal deltas are computed from **relative** band levels, smoothed and clamped by user limits.
- Up to six EQ bands are fitted to the smoothed error; edge corrections become shelves; Q comes from the width of the
  affected region.
- Loudness, dynamics, stereo width, punch and saturation use separate perceptual curves and category toggles.
- Every proposal includes reason, expected result, confidence, before/after metrics and predicted outcome.
- The plan never mutates the project. `planToNodes` converts approved proposals into ordinary processor nodes with a
  `note` explaining the recommendation.

The UI can exclude proposals, apply the rest, and then verify the actual result with an offline render.

## Persistence model

IndexedDB database `sonora-reference-studio`:

| Store | Key | Contents |
|---|---|---|
| `projects` | `id` | full `ProjectState` JSON |
| `assets` | `meta.id` | asset metadata + original file `Blob`; index by `projectId` |
| `analyses` | `assetId` | `AnalysisReport` |
| `presets` | `id` | user presets |
| `exports` | `record.id` | `ExportRecord` + encoded `Blob`; index by `projectId` |

Schema version is 1. Project objects carry their own `version` semantics through app-level migration; no destructive
migration exists yet. Deleting a project cascades to its assets and exports.

## Security and multi-user deployment

This build is local-first. It has no authentication, server API or shared storage, so there is no simulated access
control to bypass. For a hosted deployment the following is required:

- authenticated users (`sub` from the identity provider) and ownership checks on every project/asset/export query;
- signed, expiring URLs or a server proxy for private audio; never public buckets;
- MIME sniffing plus decoder validation on upload, size and duration limits, and rate limiting;
- private reference tracks by default; no training on user audio without explicit consent;
- per-user retention and deletion endpoints;
- object storage for PCM/blobs, a relational store for metadata and a job queue for renders/analysis.

The store and data layer are already separated from the DSP so they can be swapped for an API without touching the
engine.
