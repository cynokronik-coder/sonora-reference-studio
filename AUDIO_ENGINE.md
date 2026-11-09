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

- `Annex2TruePeakMeter` implements the 4-phase, 48-tap FIR interpolation coefficient set in ITU-R BS.1770-5 Annex 2. Offline analysis uses it in 512-frame chunks and flushes the 11-sample FIR tail after the final block.
- `TruePeakMeter` remains the 4x IIR estimate used by the realtime limiter. It is kept separate because the limiter's look-ahead, block detector and audio-delay alignment still need a separate end-to-end audit.
- The limiter uses the IIR estimate with a 0.5 dB safety guard. This is conservative realtime protection, not certification of standards-compliant dBTP measurement; verify delivery masters with the offline Annex 2 analysis and, for critical compliance work, an independent standards test meter.

## Loudness

`analyzeLoudness` implements the BS.1770-5 stereo programme-loudness path and EBU Tech 3341/3342 metering:
- high-shelf K-weighting (1681.97 Hz, +4 dB, Q 0.707) then RLB high-pass (38.14 Hz);
- Integrated loudness: complete 400 ms blocks, 75% overlap (100 ms hop), −70 LUFS absolute gate and −10 LU relative gate below the absolute-gated mean.
- Momentary loudness: ungated 400 ms sliding windows; short-term loudness: ungated 3 s sliding windows. Both update every 100 ms.
- File-based LRA: 3 s short-term windows with 1.5 s trailing silence, −70 LUFS absolute gate, −20 LU relative gate and 10th–95th percentile range.
- True peak: 4-phase, 48-tap FIR interpolation from BS.1770-5 Annex 2, including FIR-tail flush after the last input block. This offline analysis path is separate from the realtime limiter.
- Sample peak and RMS are measured from the original PCM, independently of K-weighted loudness.

The realtime limiter still uses its conservative 4x IIR estimator with a 0.5 dB safety guard. It is not represented as a certified Annex 2 dBTP meter; use the offline export analysis for the standards-based report.

## Reference matching

`generateMatchPlan` converts measured reports into editable processor proposals; it does not mutate the project or claim to recreate the reference waveform. A per-category source index can select one analysed reference, or a negative index selects a weighted consensus. Weighted consensus averages loudness in linear power, true peak in linear amplitude, and each spectral band in linear power before recalculating relative tonal balance. Other descriptive metrics use weighted arithmetic means.

Reference weights are relative influence values. Zero excludes a reference from a weighted blend; when all weights are zero, the resolver falls back to equal weights and keeps the analysis usable. Explicitly selecting one reference for a category takes precedence over its blend weight.

When a requested chorus or verse is unavailable in a selected reference (or in the target), the matcher uses full-track measurements and adds a visible limitation warning. It does not silently label full-track measurements as section-specific. Proposal confidence is a heuristic guidance score, not a calibrated probability; it is reduced when references disagree on the relevant characteristic or when source analysis quality is weak. The final output must still be rendered, listened to and measured.

## Reference Match before/after audition

The Reference Match audition renders the unchanged current project and the selected proposal set independently through the same offline `ProjectRenderer`, at the same project sample rate and timeline range. The proposal set replaces the master processor chain exactly as it will when the user applies that set. Both stereo PCM renders are transferred to the realtime AudioWorklet; A/B selection reads the same absolute sample index from either render, so the transport playhead, seek position and loop points remain aligned.

Switching A/B during playback uses an 8 ms linear crossfade. A and B are pre-rendered from the same project snapshot; the audition does not copy reference audio into the project, alter the project master, create undo entries, or persist temporary processor changes. Project or match-setting edits, plan regeneration, screen exit, undo/redo and project changes clear the cached audition buffers. The user must prepare another audition after making changes.

The integrated LUFS and BS.1770-5 Annex 2 true peak displayed for A and B are measured from their actual offline renders. Loudness matching defaults on and uses the quieter measured render as the shared reference; it only attenuates the louder version, capped at 24 dB, on the monitor gain path. It cannot modify exported PCM. When this audition mode is active, processor gain-reduction meters are suppressed because playback is reading the already-rendered PCM rather than live processor instances; the output peak meter still follows the audible signal.

## A/B mastering audition

Mastering A/B slots capture the current master processor chain and master fader, then measure the complete current mix with the offline renderer. The stored integrated LUFS and BS.1770-5 Annex 2 true peak therefore come from the captured version itself, not from a possibly stale previous verification.

Recalling a slot loads its master chain for realtime audition. The working mix is saved in session state and can be restored with **Return to working mix**. A slot recall is not autosaved as the permanent project master; subsequent edits to the project are saved normally. A/B slots themselves are session-only and are cleared when another project is opened.

Loudness-matched listening uses the quietest non-stale measured slot as the common reference. Other slots are attenuated by the LUFS difference, with a maximum 24 dB reduction and no positive monitor gain. This compensation is applied after the audio engine and before the monitor gain; it never changes the project render or export. A slot without a finite LUFS measurement, or one marked stale after track/bus changes, is auditionable without loudness compensation and should be recaptured before level-matched comparison.

Track or bus edits invalidate stored A/B measurements because the captured slot stores the master chain, not a duplicate of the full multitrack session. A new capture measures the complete current mix and restores a valid comparison reference.

## Automation

Lanes are stored per track: `volume`, `pan`, or a processor parameter keyed by processor id. `valueAtTime` interpolates
linearly or exponentially. Automation is evaluated at block start, applied immediately before the chain is processed, and
only for parameters that actually have lanes. Structural parameter sync happens outside the render loop.

## Latency compensation

The linear-phase EQ's 513-tap symmetric FIR has exactly 256 samples of group delay (about 5.33 ms at 48 kHz). The limiter reports its selected look-ahead delay (0–10 ms) through the same processor latency contract. `ProcessorChain` sums active processor latency and `ProjectRenderer` recomputes track, bus and master compensation when processor parameters change. Minimum-phase biquad coefficient changes are smoothed over 20 ms; this interpolation is performed per sample in the audio processing loop. `ProjectRenderer` computes the maximum track/bus
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


### Parametric EQ transitions
The minimum-phase EQ uses per-sample interpolation between stable normalized biquad coefficient sets over 20 ms when a parameter changes. The output trim is ramped over the same interval. Disabled/rerouted filters continue processing only while their transition back to passthrough is active. The optional linear-phase FIR uses 513 odd-length symmetric taps so its group delay is the exact integer 256 samples rather than the half-sample delay of an even-length kernel.


### Dynamic EQ detector behaviour
Dynamic EQ detector band-pass filters receive the signed left and right programme channels independently. Only after frequency-selective filtering are detector magnitudes compared and shaped by attack/release ballistics. This avoids the extra harmonics created by full-wave rectification before the detector filter. Stereo linking is defined per band: 0% uses independent channel envelopes; 100% derives one common envelope from the stronger detector and applies identical gain reduction to both channels. Dynamic bell filter changes use short coefficient ramps, and disabling a band ramps its response back to passthrough.


### Saturation render path
The saturator preserves the input in prepared dry buffers, processes pre-emphasis at the host rate, oversamples both channels through independent IIR filter state, runs paired nonlinear shaping with shared smoothed controls, then downsamples to prepared wet buffers. Post-tone and DC removal filters have independent channel histories. Drive, compensation, style crossfade, output trim and dry/wet mix are ramped to avoid abrupt control steps. The IIR oversampling filters have frequency-dependent phase shift; they are not linear-phase and do not have a single exact group delay. For partial wet blends the dry branch advances through an identical oversampling filter topology so the two legs have matching filter history. At exactly 0% wet, the processor returns the original dry samples. Oversampling reduces alias products but does not remove them completely.


### Exciter high-band harmonic path
The Exciter copies the original stereo programme into prepared buffers, runs independent left/right fourth-order high-pass filter cascades, and sends only the isolated upper band through a nonlinear shaper. The shaped high band is oversampled (1x/2x/4x) then downsampled. A second independent but identically configured IIR oversampler processes the linear high-band reference; subtracting that reference from the shaped band yields the harmonic delta, which is added to the original full-range programme. This keeps the low-frequency programme out of the nonlinear stage and avoids blending a phase-shifted copy of the original high band. The IIR filters have frequency-dependent phase shift, not linear phase or a single fixed group delay. A separate 20 Hz high-pass removes DC generated by asymmetric transfer functions. Drive, style, amount, output and crossover changes are smoothed; the audio callback uses preallocated buffers and rejects a block larger than the prepared capacity rather than allocating scratch memory in the realtime path.


### Clipper render path
The clipper copies left/right input into prepared dry buffers, upsamples both channels through independent IIR filter banks when 2x/4x is selected, shapes samples with the selected soft/hard/tanh transfer curve, then downsamples into prepared wet buffers. A second matching IIR oversampler advances continuously on the untouched dry input so partial wet blends use the same phase/filter history. At 0% wet the original samples are restored after the 20 ms mix ramp. Drive and internal ceiling are interpolated per oversampled sample; style crossfades and mix/output trims ramp to avoid abrupt parameter steps. The internal clipping ceiling is before output trim and is not a final true-peak guarantee. Use the downstream limiter for a delivered dBTP ceiling. The current IIR oversampler reduces aliasing but has frequency-dependent phase shift, not linear phase.


### Limiter look-ahead and detector window
The limiter's latency is the rounded configured look-ahead time in samples. Its ring buffer delays programme audio by exactly that amount. The monotonic sliding-maximum detector uses a matching window of look-ahead samples plus the current input sample; a zero-look-ahead setting therefore uses a one-sample detector window and reports zero latency. Input gain, output trim and the internal ceiling are ramped over 20 ms. The current true-peak path uses 4x IIR interpolation, a block ratio and a 0.5 dB safety guard; because the estimator is block based and IIR rather than a standards-validated FIR measurement chain, treat it as conservative protection and verify final delivery with an independent standards-compliant true-peak meter where required. The output trim is post-limiter and must stay at 0 dB when relying on the limiter's internal ceiling.


### Stereo imaging signal path
Stereo imaging uses an LR4 crossover to split the programme into low, mid and high buffers, then converts each band to mid/side. The low-band side component can be forced to zero by the mono-maker; the low-band width control only takes effect when the mono-maker is off. The control named Above-split width applies to both the mid and high crossover bands above the low split. Global width scales all band side components; mid and side trims are applied after band recombination. Balance, width, M/S trims, mono-maker amount, Haas delay time, Haas blend and output ramp over 20 ms. Fractional Haas read positions are interpolated between adjacent samples to avoid integer-sample jumps. Split-frequency changes use smoothed biquad coefficients. The Haas ring stores the post-balance right channel and advances continuously even while its blend is disabled, avoiding stale replay on reactivation. Haas is a delay-based effect and can reduce mono compatibility; do not represent it as a phase-neutral stereo-width algorithm.


### Reverb network and RT60
Sonora's reverb uses eight parallel damped feedback combs per channel followed by four serial allpass diffusers. Right-channel delay lengths are offset from the left to create a diffuse stereo tail. For each comb the feedback coefficient is derived from the realized delay length (D), sample rate (f_s) and target RT60 in seconds:
`g = 10 ** (-3 * D / (f_s * RT60))`.
This is the standard 60 dB exponential-decay relation for a feedback comb. The displayed Decay parameter now remains the actual requested RT60 independent of the Room/Hall/Plate/Spring character; those characters adjust damping, diffusion and suggested pre-delay only. Predelay storage is sized for the complete 250 ms range plus interpolation guard samples. Its fractional read uses linear interpolation. RT60, damping, diffusion, predelay, wet mix, width and output ramp over 20 ms; low/high tone filters use coefficient smoothing and update only when their target frequencies change. The reverb has no fixed algorithmic latency because its predelay is inside the wet branch; dry programme remains aligned. It is a Freeverb-derived algorithmic effect, not convolution of a measured room.


### Delay signal path
The stereo Delay preallocates independent 9-second left/right ring buffers, allowing a 3-second base time and three taps at 1x/2x/3x without invalid reads. Tempo sync maps note values to beat fractions and the BPM supplied by the project. Tap heads use fractional linear interpolation; time, feedback, width, wet mix and output are ramped over 20 ms. Ping-pong cross-feeds the delay feedback between channels; stereo mode keeps each side independent; slapback limits the selected time to 20–250 ms; multi-tap sums three time offsets with decreasing gains. Damping and feedback high-pass filters have independent channel state and their coefficients are updated only when target cutoff frequencies change. Feedback is clamped below unity (95% max). The processor's internal delay affects only the wet path, so dry programme remains aligned and reported processor latency remains zero. The 9-second ring consumes approximately 3.3 MiB at 48 kHz stereo float32 per active Delay processor, scaling linearly with sample rate.
