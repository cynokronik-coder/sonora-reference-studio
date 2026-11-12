# Testing

## Automated tests

```bash
npx vitest run
```

The suite uses synthetic signals only — no fixtures with unknown provenance.

| Area | What is asserted |
|---|---|
| FFT | forward/inverse round-trip error < 1e-8 |
| Biquad | +6 dB bell has ~6 dB gain at centre and near unity an octave away |
| Parametric EQ | a 1 kHz sine is amplified by ~6 dB through a +6 dB bell; DC is removed by a 100 Hz high-pass |
| Dynamic EQ | Peak/RMS detection, stereo linking, frequency-matched external keys, parameter automation, reset, and smoothed gain changes |
| Compressor | a signal over threshold is reduced and reports real gain reduction |
| Limiter | output stays under a -1 dBTP ceiling with lookahead, and GR is reported |
| Saturation | output remains finite and differs from input (harmonics added) |
| Multiband | summed bands remain audible and finite |
| Crossover | LR4 three-band sum stays within ±1.5 dB of the input RMS |
| Loudness | -20 dBFS stereo 1 kHz tone measures near -20 LUFS; true peak ≥ sample peak |
| Stereo | identical channels correlate at +1 and score >99% mono compatibility; inverted channels correlate at -1 and cancel |
| Tempo | 120 BPM click pattern estimates 110–130 BPM and returns at least one section |
| WAV | 16-bit header fields and data length are correct; metadata increases file size |
| AIFF | 24-bit header parses back with the correct 80-bit sample rate |
| Presets | every built-in preset references a registered processor and valid parameter keys/ranges |
| Matching | perceptual intensity curve and category disable behaviour |
| Automation | linear and exponential interpolation |

Run `npm run build` for a typecheck of the entire app plus production bundling. The build emits separate chunks for the
AudioWorklet, the offline render worker and the analysis worker.

## Timeline checks

The timeline editing primitives have focused unit coverage for grid snapping, moving clips, source-offset preservation when trimming the start, source-boundary protection when trimming the end, and minimum clip length.

## Browser checklist (not runnable in the cloud VM)

The development environment used to build this has no browser. Before trusting a release, verify manually:

1. **Timeline editing** — import a WAV, move its clip, trim both edges, change fades and clip gain, split at the playhead, duplicate and delete. Confirm edits survive reload and undo/redo.
2. **Playback** — import a WAV, press play. Audio comes from the worklet. Toggle an EQ band and hear the change.
3. **Realtime stability** — move a gain/frequency slider quickly; no clicks or dropouts. Use Chrome's performance panel if
   artifacts appear.
4. **Analysis** — import a reference; the progress overlay reaches 100% and the metrics appear. Compare against a known
   LUFS measurement of the same file.
5. **Reference match** — generate a chain, apply it, render and measure. The measured LUFS should land near the predicted
   value and the true peak should respect the ceiling.
6. **A/B** — capture slots, recall them, confirm processing changes and that loudness-matched listening compensates level
   only.
7. **Export** — render WAV 24-bit and 96 kHz, download, reopen in another tool. Verify duration, channel count, sample
   rate and that it is not silent or clipped. Use Verify inside the app to decode the stored file and re-measure.
8. **Persistence** — reload the page and reopen the project. Chains, parameters, clips, analyses and exports should
   restore. Original files remain downloadable? (assets are re-decoded; exports are re-downloadable).
9. **Errors** — try an unsupported file, a corrupt file, and a very large file. Failures should surface as messages, not
   silent no-ops.
10. **Mono compatibility** — check the correlation/mono score and audition in mono via an external monitor chain.
11. **Beginner mode** — advanced parameters hide; every remaining control still affects audio.

## Known unverified risk areas

- Vite's `?worker&url` bundling of the AudioWorklet module is verified at build time, not in a browser here.
- Browser decoding of FLAC/OGG/AAC and `OfflineAudioContext` resampling rely on native implementations.
- IndexedDB quota and large-file behaviour depend on the browser profile.
- Linear-phase EQ latency compensation is covered by design and typechecks, but not by an audio-difference test in this
  environment.

Report failures with the browser, file type and a short description; the DSP tests usually isolate whether the fault is in
processing or in the browser integration layer.
