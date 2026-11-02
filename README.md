# Sonora Reference Studio

A browser-based, reference-matched audio production environment for artists, bedroom producers and independent engineers.

Upload your song, upload one or more commercial references, measure the real differences, generate an editable
processing chain, change every parameter, and render a finished master offline.

This is **not** an AI mastering page. It is a small but genuine audio engine: one DSP graph runs both realtime
monitoring and offline export, and every control you see changes the audio.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # DSP / analysis / container tests
npm run build          # typecheck + production bundle
```

No API keys, accounts or external services are required. Everything runs in the browser.

### First session

1. **Dashboard → New project** (or import a song — a project is created automatically).
2. Import a WAV, AIFF, FLAC, MP3, AAC/M4A or OGG file.
3. Open **Reference Match Studio**, add a commercial reference, and wait for analysis to finish.
4. Set the global intensity and category amounts, then **Generate chain**.
5. Review each proposed processor, uncheck anything you do not want, and apply it to the master.
6. Edit the chain in **Mastering** or the **Mixing Studio**. Every value is a real DSP parameter.
7. **Render & measure** to verify the actual result, then **Export Center** to download.

---

## What is actually implemented

### Arrangement timeline
- Multitrack arrangement view with tempo-based bar/beat ruler and adjustable zoom.
- Snap-to-grid controls (bar, beat, half-beat and quarter-beat), fit-to-session zoom and a seekable playhead.
- Select, move, trim, split, duplicate and delete clips; edit clip gain and fade-in/fade-out lengths.
- Waveform previews, per-track mute/solo and project-persisted clip edits with undo/redo.

### Audio I/O and projects
- Multichannel-aware import of WAV, AIFF, FLAC, MP3, AAC/M4A and OGG via the browser decoder.
- Header parsing for WAV, AIFF and FLAC to display truthful sample rate, bit depth and channel count.
- Original files are preserved untouched in IndexedDB; a decoded working copy is created at the session rate.
- Session rate follows the audio device so the realtime engine never resamples silently. Imported audio is explicitly
  resampled with the browser's offline SRC when its rate differs.
- Local projects with autosave, rename, duplicate, delete, undo/redo, notes, folders and versioned master snapshots.
- Non-destructive clips: start, offset, gain, fades, split, delete.

### Measurement (no invented numbers)
- ITU-R BS.1770-4 integrated, momentary and short-term loudness, with absolute/relative gating and independent per-channel K-weighting filter state.
- Loudness range (EBU Tech 3342 style), sample peak, 4x-oversampled true peak, RMS, crest factor, PLR.
- 31-band 1/3-octave stereo power spectrum, centroid, 85% roll-off, spectral tilt, flatness, resonance and buildup detection.
- Stereo width (side/mid), correlation, L/R balance, per-band width/correlation, mono-compatibility scoring.
- Tempo from spectral-flux autocorrelation, onset density, punch score, and estimated section boundaries/labels.

### Reference matching
- Compare a target against one or many references.
- Loudness-independent tonal comparison to avoid “louder = brighter” errors.
- Per-category intensity (frequency balance, loudness, dynamics, stereo, punch, saturation, character) with a perceptual
  curve — not a blind multiplier on every parameter.
- Independent reference selection per characteristic when several references are supplied.
- Chorus/verse/full-track section selection, EQ boost/cut limits, maximum loudness change, frequency exclusions and
  low/high-end protection.
- Every proposal carries its reason, expected result, confidence, before/after metrics and a predicted result, plus
  explicit warnings where matching cannot do what a user might expect (e.g. restoring lost dynamics).
- The generated chain is fully editable after application; predictions are verified by rendering and re-measuring.

### Processing engine
Sixteen real processors, all implemented in TypeScript and shared by realtime and offline rendering:

| Processor | Highlights |
|---|---|
| Gain / routing | trim, pan, polarity, mono |
| Parametric EQ | 8 bands, bell/shelf/HP/LP/notch/band-pass/tilt, mid/side routing, linear-phase FIR mode |
| Dynamic EQ | 4 level-dependent bands with ballistics |
| Compressor | soft knee, VCA/FET/optical/vari-mu/bus behaviours, lookahead, sidechain filter, external key, dry/wet |
| Multiband compressor | 3 bands, LR4 crossovers, per-band dynamics |
| De-esser | split-band or wideband |
| Transient shaper | envelope-differential attack/sustain |
| Gate / expander | threshold, ratio, range, hold, ballistics |
| Saturation | tape/tube/console/soft/hard/wavefold transfer functions, tone, mix, 2x/4x oversampling |
| Exciter | high-band harmonic generation |
| Stereo imaging | frequency-dependent width, mono-maker, M/S trims, balance, Haas |
| Reverb | Freeverb topology, room/hall/plate/spring behaviour |
| Delay | stereo, ping-pong, slapback, multi-tap, tempo sync |
| Resonance suppressor | three high-Q dynamic notches |
| Clipper | soft/hard/tanh, ceiling, mix |
| Limiter | look-ahead sliding maximum, true-peak-aware ceiling, programme release |

Additional engine features: drag-to-reorder chains, bypass, duplicate, reset, presets, external sidechain keys, group
buses and sends, solo/mute/polarity/mono, automation lanes, per-channel metering, and latency compensation between paths.

### Assistant
A deterministic natural-language interpreter edits the current chain: brightness, harshness, mud, bass tightness, punch,
width, depth, compression, loudness, de-essing and removal/bypass requests. It previews operations, never duplicates an
existing processor when one can be adjusted, and supports follow-ups such as “that's too much” (numeric deltas are
scaled) and “keep the EQ but remove the exciter”. No external LLM key is used; measurements are never generated by
language logic.

### Export
- Offline rendering in a Web Worker using the same graph as playback.
- WAV 16/24-bit PCM and 32-bit float, AIFF 16/24-bit, MP3 320 kbps (44.1/48 kHz).
- Sample rates: 44.1, 48, 88.2, 96 kHz (browser SRC for non-session rates).
- TPDF dither when reducing bit depth, optional true-peak normalisation, metadata, filename control.
- Export history stored locally, re-download and independent re-decode verification.

---

## Verified status

Run in this environment:

- `npx tsc -p tsconfig.app.json --noEmit` → passes.
- `npm run build` → passes (client bundle plus dedicated worklet and worker chunks).
- `npx vitest run` → DSP, loudness, spectrum/stereo/tempo analysis, crossovers, containers, presets and automation tests.

**Not verified here:** this VM has no browser, so the interactive AudioWorklet path, IndexedDB persistence, real file
decoding and the visual UI have not been exercised end-to-end. The DSP they call is covered by Node tests. See
[TESTING.md](TESTING.md) for the exact browser checklist and known risk areas.

---

## Honest limitations

- **No AI stem separation.** A stereo mix cannot be split into vocals/drums/bass inside this build. Any UI that
  suggests otherwise is not present. Instrumental/vocal-only export therefore does not exist.
- **No accounts or collaboration.** The app is local-first: projects and audio live in this browser. There is no
  server-side user table, sharing, comments or access-control layer in this build. See
  [ARCHITECTURE.md](ARCHITECTURE.md) for the proposed deployment model.
- **No external LLM control.** The assistant is deterministic and offline by design.
- **No batch processing, DAW session import or hardware inserts.**
- **Dynamic range cannot be expanded upward.** If the source is already over-compressed, the matcher reports this rather
  than claiming an expander can restore lost transients.
- **One bus level.** Tracks can route to buses and buses to master; arbitrary nested bus feedback is not supported.
- **Automation UI is minimal.** Lanes exist, render and persist in the engine, but the current interface does not expose
  a full point editor.
- **Comparison is perceptual, not identity.** Matching changes measurable tendencies; it cannot clone the arrangement,
  performance or instruments of a reference.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system layers, data flow, storage model, deployment notes.
- [AUDIO_ENGINE.md](AUDIO_ENGINE.md) — signal flow, blocks, latency, oversampling, true peak, LUFS, adding processors.
- [PROCESSORS.md](PROCESSORS.md) — every processor, its parameters and engineering notes.
- [DEVELOPMENT.md](DEVELOPMENT.md) — setup, project layout, extension recipes, environment variables.
- [TESTING.md](TESTING.md) — automated coverage, synthetic signals, browser checklist.
- [API.md](API.md) — store actions, worker/worklet message protocols, module boundaries.

Built with React, TypeScript, Vite and Tailwind. No audio processing is delegated to Web Audio nodes; the Web Audio API is
used only as a host for the custom AudioWorklet, with all DSP implemented in this repository.
