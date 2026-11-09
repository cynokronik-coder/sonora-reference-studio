# Processors

All processors are stereo, sample-accurate, and implemented in this repository. The rack, presets, matching engine and
export all use these same definitions.

## Utility

### Gain / Routing
Input trim, output trim, constant-power pan, polarity invert and mono fold-down. Used for gain staging and as the
loudness correction stage in generated chains.

## EQ

### Parametric EQ
- Eight bands with bell, low shelf, high shelf, high-pass, low-pass, notch, band-pass and tilt shapes.
- Per-band frequency, gain, Q / shelf slope and stereo, mid-only or side-only routing. The signal is processed in M/S, so a Mid-only band cannot change a purely Side signal and vice versa.
- Shelf slope uses the RBJ Audio EQ Cookbook S parameter, clamped to 0.1–1.0. The UI labels it separately from Q; non-shelf filters retain a Q range of 0.2–18. Invalid or non-finite imported parameters are bounded before coefficients are designed.
- The response display uses the current project sample rate and shows separate Mid and Side curves when their responses differ. One combined curve is shown when they are the same.
- Optional linear-phase mode designs a **513-tap symmetric FIR** from the magnitude response of the biquad cascade (frequency sampling, inverse FFT and windowing). Its group delay is exactly 256 samples; at 48 kHz this is about 5.33 ms. The minimum-phase path remains the default.
- Factory starting points include Low-end cleanup, Vocal presence, High-frequency air, Warm tonal balance, Low-mid clarity and Mid-side openness. All bands and routing values remain editable.

### Dynamic EQ
Four bell bands whose gain is driven by a bandpass detector. Threshold, maximum cut, attack and release per band. Gain
reduction is reported for the rack meter and is genuinely level-dependent.

### Resonance Suppressor
Three high-Q dynamic notches (Q 1–30) with sensitivity and maximum cut. Frequencies can be set from the analysis engine's
resonance report.

## Dynamics

### Compressor
- Soft-knee feed-forward design with independent left/right detector filters, RMS states and dB-domain gain-reduction ballistics.
- Stereo Link has defined operation: 0% uses independent dual-mono detectors/envelopes; 100% uses the stronger channel's detector for common stereo gain reduction; intermediate values blend each channel's detector towards the stronger side.
- Left and right sidechain high-pass filters have independent histories, avoiding inter-channel filter-state contamination.
- Styles (VCA/FET/Optical/Vari-mu/Bus) change attack/release scaling, knee, ratio scaling and RMS detection blend. These
  are **behaviour styles**, not emulations of specific hardware circuits.
- Lookahead delays the audio so gain reduction arrives before the transient.
- Sidechain high-pass filtering, auto/manual makeup and dry/wet blend.
- Factory starting points: Transparent control, Bus glue, Punchy FET, Smooth optical and Dual mono. They load complete parameter snapshots; every value remains editable.
- External sidechain key can be routed from another track on track or bus compressor instances. The key is tapped from the source track's raw clip signal before its own processing and fader; disconnecting it returns the detector to the compressed signal.

### Multiband Compressor
- Three bands split by cascaded LR4 filters at adjustable low/mid and mid/high frequencies. The neutral configuration is tested across 44.1, 48 and 96 kHz, including tones close to both crossover points.
- Every band has its own threshold, ratio, attack, release, knee, makeup, dry/wet, behaviour style and stereo-link amount.
- External sidechain audio is passed through a second, matched LR4 crossover. The low-band compressor therefore detects the low band of the key, the mid compressor detects the mid band, and the high compressor detects the high band; a broadband external key does not make all three detectors react identically.
- **Compression enabled** bypasses gain reduction for that band while keeping the band audible. **Solo band** auditions one or more frequency regions without changing the source project.
- The meter reports the strongest band reduction plus per-band gain reduction. Factory starting points include Low-end control, Gentle multiband glue, Presence smoothing, Modern density, and Dynamic and open. All settings remain editable.

### De-esser
LR4 split above a tunable frequency; the high band is detected and dynamically reduced. Wideband mode applies the same
reduction to the whole signal. Per-block gain reduction is metered.

### Transient Shaper
Fast vs slow envelope comparison: transient energy drives attack gain, sustained energy drives sustain gain. Sensitivity,
mix and output are adjustable.

### Gate / Expander
Downward expander with threshold, ratio, range, attack, hold and release.

### Clipper
Soft cubic, hard or tanh clipping with drive, ceiling, mix and output. Intended before the limiter to shave isolated
peaks; it genuinely adds harmonics.

### Limiter
Look-ahead brickwall. A monotonic sliding maximum over the lookahead window computes the required gain before the
transient arrives. Release is programme-scaled. True-peak mode uses 4x interpolation to tighten the ceiling for
inter-sample peaks. Reports gain reduction and output peak.

## Saturation

### Saturation
Six transfer functions: tape (asymmetric soft bias), tube (second-harmonic asymmetry), console (cubic), soft clip, hard
clip and wavefold. Drive, tone, dry/wet, output and 2x/4x oversampling. The interface labels these as styles, not
hardware models.

### Exciter
High-band harmonic generation above a tunable crossover, with drive, style, amount and output. Never distorts the low
end.

## Stereo

### Stereo Imaging
Frequency-dependent width: low band, high band and global width, with a mono-maker below the split. Mid/side trims,
balance, output, and an optional Haas delay with its own mix (documented as a mono-compatibility trade-off).

## Time

### Reverb
Freeverb-derived topology: eight parallel damped comb filters and four allpass diffusers per channel, with stereo spread.
Room/hall/plate/spring presets alter feedback, damping, diffusion and default pre-delay. Pre-delay, decay, damping, width,
low/high cut, wet mix and output. Algorithmic synthesis, not convolution.

### Delay
Stereo, ping-pong, slapback and multi-tap modes. Tempo-synced note values or free milliseconds, feedback, damping,
high-pass, width, wet mix and output. Buffers support up to 2.9 s.

## Parameters and automation

Every numeric parameter can be automated. Boolean parameters control bypass/enable-style behaviour. Presets store
ordinary parameter maps, so loading one is exactly equal to setting the same controls manually.
