# Processors

All processors are stereo, sample-accurate, and implemented in this repository. The rack, presets, matching engine and
export all use these same definitions.

## Utility

### Gain / Routing
Input trim, output trim, constant-power pan, polarity invert and mono fold-down. Used for gain staging and as the
loudness correction stage in generated chains.

## EQ

### Parametric EQ
8 bands. Types: bell, low shelf, high shelf, high-pass, low-pass, notch, band-pass, tilt. Per-band frequency/gain/Q and
routing (stereo, mid, side). Processing happens in M/S so a mid-only or side-only band behaves correctly; a stereo band
applies identical filters to both sides. **Linear phase** mode designs a 512-tap symmetric FIR from the exact magnitude
response of the biquad cascade (frequency sampling + inverse FFT + windowing), adding 256 samples of latency. The
minimum-phase path is default.

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
Three bands from LR4 crossovers at adjustable splits. Each band runs an independent compressor with its own threshold,
ratio, attack, release, knee, makeup, character and mix. Bands sum after compression.

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
