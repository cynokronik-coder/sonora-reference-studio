# Audio engine

## Design rules

1. **No decorative DSP.** Every processor listed in the rack is executed on the audio graph.
2. **One implementation, two hosts.** Realtime and offline use the same `ProjectRenderer`.
3. **Block processing.** The graph renders fixed blocks (128 frames realtime, 512 offline). Every processor must accept
   any `n <= maxBlock`.
4. **Explicit state.** Processors keep filter/envelope state between blocks; `reset()` clears tails on seek or when a
   chain is replaced.
5. **No hidden resampling.** The session runs at the audio device rate. Imports are explicitly resampled at import; export
   resamples explicitly at the chosen rate.

## Signal flow

```
Clip fill (offset, gain, fades)
  → polarity / mono
  → track processor chain
  → latency compensation delay
  → pre-fader sends
  → fader + constant-power pan
  → post-fader sends
  → bus accumulators
  → bus chain → bus fader → bus compensation
  → master chain → master gain
  → meter snapshot / output
```

Solo logic: if any track is soloed, only soloed tracks contribute. Muted buses are zeroed. Reference tracks behave like
audio tracks and can be auditioned independently.

## The chain

`ProcessorChain` receives `{ id, type, enabled, params }[]`. It:
- reuses instances by id so filter state survives parameter edits and reordering;
- calls `setValues(params)` only when a JSON signature changes;
- skips disabled nodes;
- exposes summed enabled latency and current meter values.

Adding a processor never rebuilds the chain. Removing one disposes it. This is why dragging a rack item or automating a
parameter does not click.

## Parameters

Parameters are flat numeric maps (`bool` as 0/1, enums as indices). Every processor definition declares `ParamSpec`s,
which drive:
- rack controls,
- validation/clamping,
- automation targets,
- the assistant and presets.

This keeps the UI and the engine from drifting apart.

## Oversampling

`Oversampler` performs 2x/4x zero-stuffing plus 8th-order Butterworth IIR anti-image/anti-alias filtering. It is used
around nonlinear stages (saturation, exciter, clipper, saturation modes). IIR was chosen over FIR to avoid extra latency
in the realtime path.

## True peak

- `TruePeakMeter` applies a 4x oversampled low-pass chain and tracks the maximum absolute interpolated sample.
- Analysis uses it in 512-frame chunks to measure dBTP over the whole file.
- The limiter measures each block's oversampled peak and tightens its effective ceiling by the derived
  inter-sample/sample-peak ratio. That means masters meet a dBTP ceiling rather than only a sample-peak ceiling.

## Loudness

`analyzeLoudness` implements BS.1770-4:
- high-shelf K-weighting (1681.97 Hz, +4 dB, Q 0.707) then RLB high-pass (38.14 Hz);
- 400 ms blocks with 100 ms hops;
- absolute gate −70 LUFS, relative gate −10 LU below the gated mean;
- integrated value from the gated mean power;
- 3 s short-term windows for LRA;
- momentary and short-term series for graphs.

True peak and sample peak are measured independently. LRA follows the 10th/95th percentile method with absolute and
relative gates.

## Automation

Lanes are stored per track: `volume`, `pan`, or a processor parameter keyed by processor id. `valueAtTime` interpolates
linearly or exponentially. Automation is evaluated at block start, applied immediately before the chain is processed, and
only for parameters that actually have lanes. Structural parameter sync happens outside the render loop.

## Latency compensation

The linear-phase EQ's 512-tap FIR has 256 samples of group delay. `ProjectRenderer` computes the maximum track/bus
latency and inserts integer delays on the other paths, including the intermediate bus stage. Offline export renders
`totalLatency` extra frames and discards the head. All paths therefore remain sample-aligned.

## Adding a processor

1. Create `src/audio/dsp/processors/myProcessor.ts` implementing `AudioProcessor`.
2. Export a `ProcessorDefinition` with `ParamSpec`s.
3. Register it in `src/audio/dsp/registry.ts`.
4. Add a test using a synthetic signal.

No UI work is required: the Add Processor menu, rack editor, automation, presets, matching and export support it
automatically. If the processor needs latency, report it in `latency`; the renderer compensates.

## Performance notes

- Analysis runs in a worker; rendering runs in a worker or worklet, never on the main thread.
- The offline renderer reports progress and checks a cancellation flag between blocks.
- Assets are transferred to hosts as copies; the main-thread decoded buffers remain available for analysis and waveform
  drawing.
- Memory scales with total imported PCM. Very large multitrack stem sets should be split into projects in this build.
- The UI meter stream is throttled to roughly 60 Hz (every fourth worklet block).


### Multiband sidechain routing
The multiband compressor maintains a dedicated crossover for its external key input. Track or bus sidechain keys are split at the same low/mid and mid/high frequencies as the programme, then routed to the matching band's compressor detector. This keeps low-band compression from reacting to unrelated high-frequency key energy. When no external key is connected, each band explicitly uses its own programme band as the detector input.
