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
applies identical filters to both sides. Minimum-phase coefficient changes and output-trim changes ramp over 20 ms to
reduce zipper noise and abrupt filter transitions. The optional **linear phase** mode designs a 513-tap symmetric FIR
from the sampled magnitude response of the biquad cascade (frequency sampling + inverse FFT + windowing), adding
exactly 256 samples of group delay (about 5.33 ms at 48 kHz). Factory starting points include Low-end cleanup, Reduce
mud, Vocal presence, Air and clarity, Warm balance, Resonance notch and Gentle master tilt; all bands remain editable.

### Dynamic EQ
Four dynamic bell bands with independent left/right raw-signal band-pass detectors. Detection runs on signed programme
samples before the envelope measurement; it does not rectify the signal before filtering, avoiding false octave triggers
from generated harmonics. Per-band threshold, ratio, maximum cut, attack, release, Q and stereo link are editable.
At 0% link, each channel has its own detector envelope and dynamic EQ gain; at 100%, one shared envelope applies
identical gain reduction to both channels. Detector-frequency changes and dynamic bell coefficients are smoothed to
reduce abrupt filter transitions. Disabled bands ramp back to passthrough. Per-band reduction and maximum total reduction
are reported to the processor rack. Factory starting points include Vocal harshness, Low-mid control, Bass note control,
High-frequency smoothing and Gentle dynamic balance.

### Resonance Suppressor
Three high-Q dynamic notches (Q 1–30) with per-channel signed-signal band-pass detection. The detector selects the
frequency region before measuring its envelope, avoiding rectification-generated harmonic triggers. Stereo Link can
operate dual-mono at 0% or use a shared maximum detector at 100%. Attack and release are adjustable; notch frequency/Q
changes and attenuation transitions are smoothed. Dry/wet is a true parallel blend against a preserved dry copy, and
output trim and mix changes ramp over 20 ms. Per-band and maximum gain reduction are reported to the rack.
Factory starting points include Gentle resonance control, Vocal harshness, Snare ring and Mix harshness.

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
ratio, attack, release, knee, makeup, character, dry/wet mix and stereo-link amount. Band bypass preserves the split
signal without compression; band solo auditions an individual frequency region. External sidechain audio is split
through a separate LR4 network at the same frequencies, so each band detector listens to its corresponding key band
rather than receiving the full-range key. The processor reports per-band gain reduction and the maximum band reduction.
Factory starting points include Low-end control, Gentle multiband glue, Presence control and Dynamic master.

### De-esser
Fourth-order Linkwitz–Riley split above a tunable crossover. High-band detection is measured after frequency selection,
with independent left/right envelopes or a shared linked envelope. Split-band mode attenuates only the high band;
wideband mode applies the same reduction to the complete recombined signal. Threshold, ratio, maximum reduction,
attack, release and stereo link are editable. Crossover changes and mix/output changes are smoothed. A preserved dry
copy supports true parallel blending. Factory starting points include Gentle sibilance, Bright vocal, Strong
sibilance and Wideband control.

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
