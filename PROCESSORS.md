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
Independent left/right fast (0.4 ms attack / 30 ms release) and slow (25 ms / 180 ms) envelope followers estimate transient
difference and sustained body. Attack and sustain controls apply bounded dB changes (attack up to ±12 dB, sustain up
to ±6 dB before the combined ±18 dB safety bound), avoiding negative linear gain and polarity inversion. Stereo Link
blends each channel's envelope features towards the stronger side; 100% applies the same gain to both channels, while
0% follows each side independently. Gain, output and dry/wet transitions are smoothed. Factory starting points include
Punch and attack, Soften transients, Longer sustain, Drum snap and Gentle dynamics.

### Gate / Expander
Downward expander with independent left/right peak detectors and per-channel gain-reduction envelopes. The Stereo Link
control blends each detector towards the stronger channel; at 100% both channels share one envelope, preventing stereo
image shifts when one side crosses threshold first. Expansion follows the conventional dB-domain slope: for a hard knee,
gain reduction below threshold is (ratio − 1) × distance below threshold, capped by the Range control. A continuous
quadratic soft knee smooths the transition around threshold. Attack, hold, release, range, ratio, knee, stereo link,
dry/wet and output are editable. Output gain and dry/wet changes are smoothed. Left/right gain reduction is displayed
independently. Factory starting points include Gentle expander, Tight drum gate, Vocal noise control and Strong cleanup.

### Clipper
Three transfer curves: Soft (odd cubic, unity slope at zero and zero-slope transition at the internal ceiling), Hard
(exact sample-domain clamp at the internal ceiling) and Tanh (rounded asymptotic curve). Drive and clip ceiling are
ramped over 20 ms; style crossfades, dry/wet and output changes are smoothed. 1x/2x/4x oversampling is selectable.
The IIR oversampler reduces aliasing but is not linear-phase and has frequency-dependent phase shift. A matched
oversampled dry reference is maintained for parallel blends; at settled 0% wet the original samples are returned
exactly. Left/right processing and peak/reduction meters are independent. The clip ceiling applies before post-clip
output trim, so positive output gain can exceed it; use the downstream limiter for a final dBTP ceiling. Factory
starting points include Soft peak rounding, Drum impact, Tanh smoothness, Mastering peak shave and Hard creative clip.

### Limiter
Stereo-linked look-ahead limiter with a monotonic sliding maximum whose detector window is exactly the configured
look-ahead length plus the current sample. The processor reports the corresponding delay in samples so the renderer
can latency-compensate other tracks and buses; the range is 0–10 ms. Attack is immediate after the look-ahead window;
release is programme-smoothed. Input gain, output trim and ceiling changes ramp over 20 ms. True-peak mode uses a 4x
IIR interpolation estimate to tighten the internal ceiling, with an additional 0.5 dB safety guard to cover the
block-based estimate and delayed output alignment. This is an engineering safety margin, not a certified
standards-compliant true-peak meter; verify final deliverables with an independent meter when broadcast/delivery
specifications require it. Output trim is after limiting and can raise the final signal above the limiter ceiling, so
leave it at 0 dB for ceiling compliance. The rack reports gain reduction and separate left/right output peaks.
Factory starting points include Transparent true-peak, Punch preservation, Loudness push, Safe delivery and
Low-latency sample peak.

## Saturation

### Saturation
Six nonlinear transfer functions: Tape (asymmetric soft saturation), Tube (asymmetric even-harmonic character), Console
(cubic soft knee), Soft clip (tanh), Hard clip and Wavefold. Drive, pre-emphasis, post-tone shelf, output trim and dry/wet
are available. Drive/compensation, style, tone, output and mix changes are smoothed rather than stepped abruptly.
Left/right pre-filter, post-tone, DC-blocker and oversampler state are independent; they must never share filter history.
The audio callback uses prepared scratch buffers rather than allocating new audio buffers per render block. 1x, 2x and 4x
oversampling choices are exposed. The current oversampler is a cascaded IIR design: it reduces aliasing but is not
linear-phase and has frequency-dependent phase shift. When a parallel mix is used, the dry branch follows a matching
oversampling filter history for phase alignment; at exactly 0% wet the output remains the original dry signal.
Factory starting points include Tape warmth, Tube density, Console glue, Soft peak rounding, Hard edge, Wavefold colour
and Subtle mastering density. These are editable starting points, not hardware emulations. Always level-match before
judging the effect; oversampling reduces but does not eliminate aliasing.

### Exciter
A fourth-order high-pass isolates the selected upper band before nonlinear processing; the full-range programme never
enters the waveshaper. The processor adds only the difference between the shaped, phase-aligned high band and its
linear counterpart back to the original programme. Low-frequency content therefore remains on the original dry path
rather than being driven through saturation. Tape, Tube, Console, Soft clip and Wavefold styles are available, with
Drive, Crossover, Amount and Output controls. Amount and output transitions are smoothed. 1x, 2x and 4x oversampling
are selectable; the paired IIR dry branch follows matching filter history for the high-band subtraction. The IIR
oversampler has frequency-dependent phase shift and is not linear-phase. A 20 Hz DC blocker removes offset that may be
generated by asymmetric waveshaping. Factory starting points include Vocal air, High-end sparkle, Drum and cymbal
detail, Synth presence and Subtle mastering air. All values remain editable; oversampling reduces but does not
eliminate aliasing.

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
