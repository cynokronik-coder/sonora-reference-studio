# Processors

All processors are stereo, sample-accurate, and implemented in this repository. The rack, presets, matching engine and
export all use these same definitions.

## Utility

### Gain / Routing
Input trim, output trim, constant-power pan, polarity invert and mono fold-down. Used for gain staging and as the
loudness correction stage in generated chains.

## EQ

### Parametric EQ
Eight bands with bell, low shelf, high shelf, high-pass, low-pass, notch, band-pass and tilt shapes. Per-band frequency,
gain, Q / shelf slope and stereo, mid-only or side-only routing. Processing happens in M/S so routed bands affect only
their selected channel; a stereo band applies identical filters to both. RBJ shelf slope is clamped to 0.1–1.0 and
other filter Q remains 0.2–18; imported values are bounded before coefficient design. Minimum-phase coefficient and
output-trim changes ramp over 20 ms. **Linear phase** mode designs a symmetric 513-tap FIR from the biquad cascade's
magnitude response, with exactly 256 samples of group delay (about 5.33 ms at 48 kHz). EQ has no separate wet/dry
control: the enabled processor is fully wet, while rack bypass passes the signal unchanged. Minimum phase remains default.

### Dynamic EQ
Four bell bands with independent left/right band-pass detectors, selectable Peak or RMS mode, configurable stereo link,
and optional frequency-aware external keys. Threshold, ratio, knee, maximum cut, attack, release and RMS window are
available per band. Detector histories reset with the processor; frequency and dynamic-gain coefficient changes are
smoothed. Added controls default to the prior fixed-ratio, hard-knee, Peak, fully linked behavior for older projects.
Overall and per-band gain reduction are reported to the rack.

### Resonance Suppressor
Three high-Q dynamic notches (Q 1–30) with sensitivity and maximum cut. Frequencies can be set from the analysis engine's
resonance report.

## Dynamics

### Compressor
- Soft-knee feed-forward design with dB-domain ballistics.
- Styles (VCA/FET/Optical/Vari-mu/Bus) change attack/release scaling, knee, ratio scaling and RMS detection blend. These
  are **behaviour styles**, not emulations of specific hardware circuits.
- Left and right detectors and gain-reduction envelopes are independent at 0% Stereo Link; full link follows the
  stronger detector for common stereo gain reduction. Link, makeup and dry/wet changes are smoothed over 10 ms.
- Lookahead delays the audio so gain reduction arrives before the transient. The reported latency is the exact rounded
  lookahead delay in samples and participates in renderer path compensation.
- Sidechain high-pass filter, auto/manual makeup, dry/wet.
- External sidechain key can be routed from another track on track or bus compressor instances. The key is tapped from the source track's raw clip signal before its own processing and fader; disconnecting it returns the detector to the compressed signal.

### Multiband Compressor
Three bands from complementary LR4 crossovers at adjustable splits. Low, mid and high bands reconstruct with a flat
magnitude response and continuous phase near the crossover boundaries. An external key is split by a separate crossover at the same frequencies,
so each detector receives only its matching key band. Each band has independent threshold, ratio, attack, release, knee,
makeup, character, mix and stereo link; solo auditions selected band(s) without changing the saved band or compressor
settings. Crossover, solo, compression-bypass and output changes are smoothed to avoid abrupt signal steps. Older
projects without the newer per-band solo or link values use the defaults (not soloed, fully linked).

### De-esser
LR4 split above a tunable frequency; the high band is detected and dynamically reduced. Wideband mode applies the same
reduction to the whole signal. Per-block gain reduction is metered.

### Transient Shaper
Fast vs slow envelope comparison: transient energy drives attack gain, sustained energy drives sustain gain. Sensitivity,
mix and output are adjustable.

### Gate / Expander
Downward expander with threshold, ratio, range, attack, hold and release.

### Clipper
Three transfer curves: Soft (odd cubic, unity slope at zero and zero-slope transition at the internal ceiling), Hard
(exact sample-domain clamp at the internal ceiling) and Tanh (rounded asymptotic curve). Drive and clip ceiling are
ramped over 20 ms; style crossfades, dry/wet and output changes are smoothed. 1x/2x/4x oversampling is selectable.
The IIR oversampler reduces aliasing but is not linear-phase and has frequency-dependent phase shift. A matched
oversampled dry reference is maintained for parallel blends; at settled 0% wet with output at 0 dB the original samples
are returned exactly. Left/right processing and peak/reduction meters are independent. The clip ceiling applies before
post-clip output trim, so positive output gain can exceed it; use the downstream limiter for a final dBTP ceiling.
Factory starting points include Soft peak rounding, Drum impact, Tanh smoothness, Mastering peak shave and Hard
creative clip.

### Limiter
Look-ahead brickwall. A monotonic sliding maximum over the lookahead window computes the required gain before the
transient arrives. Release is programme-scaled. True-peak mode uses 4x interpolation to tighten the ceiling for
inter-sample peaks. Reports gain reduction and output peak.

## Saturation

### Saturation
Six nonlinear transfer functions: Tape (asymmetric soft saturation), Tube (asymmetric even-harmonic character), Console
(cubic soft knee), Soft clip (tanh), Hard clip and Wavefold. Controls include drive, pre-emphasis, post-tone shelf,
output trim, dry/wet and 1x/2x/4x oversampling. Left/right pre-filter, post-tone, DC-blocker and oversampler state are
independent. The audio callback uses prepared scratch buffers; drive/compensation, style, tone, output and mix changes
are smoothed rather than stepped. The IIR oversampler has frequency-dependent phase shift, is not linear-phase, and
reduces rather than eliminates aliasing. The dry branch uses matching IIR filter history for partial wet blends.
Factory starting points: Tape warmth, Tube density, Console glue, Soft peak rounding, Hard edge, Wavefold colour and
Subtle mastering density. These are editable starting points, not hardware emulations; level-match when comparing.

### Exciter
A fourth-order high-pass isolates the selected upper band before nonlinear processing. The Exciter adds the difference
between the shaped high band and a phase-matched linear reference back to the untouched programme, preserving the
original low-frequency path. It has a tunable crossover, drive, five styles, amount, output and 1x/2x/4x oversampling.
Prepared buffers, independent stereo filter state, DC blocking and smoothed controls protect the render path.
Factory starting points: Vocal air, High-end sparkle, Drum and cymbal detail, Synth presence and Subtle mastering air.
These presets remain editable; check for added sibilance and hiss on bright sources.

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
