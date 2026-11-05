# Internal APIs

The app includes a small Node HTTP server in `server/index.mjs`. Audio project state remains local-first; account and billing endpoints are server-backed when Supabase and Stripe are configured.

## Account and billing routes

| Route | Method | Behaviour |
|---|---|---|
| `/api/billing/status` | GET | Reports whether Supabase/Stripe configuration and plan Price IDs are present. |
| `/api/billing/entitlements` | GET | Verifies Supabase bearer token and returns server-derived plan plus monthly AI allowance and usage. |
| `/api/billing/checkout` | POST | Authenticated; accepts a plan key and interval, maps to a server-side Stripe Price ID, and returns a Checkout URL. |
| `/api/billing/portal` | POST | Authenticated; creates a Stripe customer-portal session for the account's linked customer. |
| `/api/webhooks/stripe` | POST | Verifies Stripe signature against the raw request body, synchronizes subscription state and records event IDs. |
| `/api/assistant` | POST | Connected AI; when Supabase is configured verifies the user and atomically reserves/captures one AI credit per successful request. |

The server never accepts a Stripe Price ID or amount from the browser. It resolves the permitted plan/interval pair from environment variables. Supabase elevated keys and Stripe secrets are server-only. In production, connected AI refuses to run when Supabase authentication and usage controls are not configured.

## Store (`src/state/store.ts`)

```ts
interface ExportSettings {
  format: 'wav' | 'aiff' | 'mp3';
  bitDepth: 16 | 24 | 32;
  sampleRate: number;
  startSec: number;
  endSec: number;
  mode: 'master' | 'track';
  trackId?: string;
  dither: boolean;
  normalize: boolean;
  filename: string;
  metadata: { title: string; artist: string; comment: string };
}
```

Key actions:

| Action | Behaviour |
|---|---|
| `createProject(name?)` | initialises the audio context, creates and saves an empty project |
| `openProject(id)` | restores state, decodes assets at the session rate, loads analyses/exports |
| `importFiles(files, role)` | validates, decodes, resamples, stores blob + metadata, creates tracks/clips, analyses target/reference |
| `analyzeAsset(id)` | runs the analysis worker and persists the report |
| `mutate(fn, {coalesce?})` | transactional project edit with undo snapshot, autosave and engine sync |
| `addProcessor/updateProcessorParams/...` | chain edits that never reset unrelated processors |
| `generateMatch` / `applyMatchPlan(ids?)` | plan generation and application to the master chain |
| `verifyMaster()` | offline render + measurement of the current master |
| `sendAssistantMessage` / `applyAssistantProposal` | preview and commit conversational edits |
| `captureSlot/recallSlot` | A/B master snapshots with optional loudness matching |
| `exportMix(settings)` | offline render, optional resample, encode, download, record + master version |

## RealtimeHost (`src/audio/engine/realtime.ts`)

```ts
await host.initialise();            // creates AudioContext + loads the worklet
host.loadAssets(engineAssets);      // incremental, transferable copies
host.pushProject(project);          // full JSON config; reconciled by processor id
await host.play(positionSeconds);
host.pause(); host.seek(sec); host.stop();
host.setLoop(enabled, start, end);
host.setMonitorGain(db); host.setComparisonGain(db);
const off = host.onMeters(payload => ...);
const off2 = host.onPosition((sec, playing) => ...);
```

`RealtimeMeters` contains master peak dB, per-channel linear peaks keyed by track/bus/master id, and per-processor gain
reduction keyed by owner then processor id.

## Worklet messages

Main → worklet: `assets`, `configure`, `play`, `pause`, `seek`, `loop`, `stop`.
Worklet → main: `ready`, `configured`, `position`, `meter`, `ended`.

Worklet meter payload: `{ peakL, peakR, gr, peaks, position, playing }`.

## Offline worker

Request: `{ type: 'render', project, assets, sampleRate, startSec, endSec }` or `{ type: 'cancel' }`.
Responses: `progress`, `done` (transferred PCM + measured stats), `cancelled`, `error`.

## Analysis worker

Request: `{ type: 'analyze', assetId, L, R, sampleRate, includeSections }` with transferred PCM, or
`{ type: 'loudness', L, R, sampleRate }`.
Responses: `progress`, `done` (report), `loudness`, `error`.

## Processor contract

```ts
interface AudioProcessor {
  readonly type: string;
  readonly latency: number;
  prepare(sampleRate: number, maxBlock: number): void;
  setValues(values: Record<string, number>): void;
  process(L: Float32Array, R: Float32Array, n: number): void;
  reset(): void;
  meter(): { reduction?: number; peakL?: number; peakR?: number; bands?: number[] };
  setSidechain?(L: Float32Array | null, R: Float32Array | null): void;
}
```

`ProcessorDefinition` adds metadata and a parameter schema used by every consumer.
