# DSP references — saturation and nonlinear processing

These sources are design references used to explain the engineering decisions in Sonora. Sonora's processors are implemented in this repository; no JUCE or Faust implementation code is copied into the saturator.

## Oversampling and nonlinear processing

- JUCE `juce::dsp::Oversampling` API: https://docs.juce.com/develop/classjuce_1_1dsp_1_1Oversampling.html
  - Documents the upsample → nonlinear processing at a higher rate → downsample workflow.
  - Describes the FIR versus IIR trade-off: FIR can preserve linear phase but introduces more latency; IIR minimises latency while introducing phase distortion.
- JUCE implementation reference: https://github.com/juce-framework/JUCE/blob/master/modules/juce_dsp/processors/juce_Oversampling.cpp
  - Useful for understanding staged oversampling, filter choices, state reset and latency reporting. This is a reference only; Sonora's filter implementation is separate.
- Faust 101 — Frequency aliasing beyond SR/2: https://faustdoc.grame.fr/workshops/2020-04-10-faust-101/
  - Explains that harmonics above the Nyquist frequency fold back into the audible spectrum and demonstrates why band-limited processing matters.

## Control smoothing

- Faust manual — Smoothing: https://faustdoc.grame.fr/manual/syntax/
  - Explains why UI controls that update more slowly than audio-rate processing need smoothing to avoid clicks and abrupt transitions.

## Sonora implementation notes

- Saturation uses its own paired stereo IIR oversampling state; it does not share left/right filter histories.
- Oversampling reduces aliasing; the current IIR topology is not linear-phase and must not be described as such.
- The dry path advances through a matching oversampler when a partial wet blend is active. Exact 0% wet returns the original dry samples.
- The test suite checks stereo-state independence, the dry path, finite output during control changes, factory parameter validity and a folded-harmonic alias component.
- Passing a synthetic alias regression test does not replace listening tests on varied programme material or independent spectral measurements.


## Clipping and peak shaping
- JUCE `juce::dsp::Oversampling` reference: https://docs.juce.com/develop/classjuce_1_1dsp_1_1Oversampling.html — staged oversampling around nonlinear processors, and the IIR versus FIR phase/latency trade-off.
- Faust 101 aliasing workshop: https://faustdoc.grame.fr/workshops/2020-04-10-faust-101/ — harmonic folding above Nyquist and why nonlinear stages benefit from oversampling.
- Clipper regression cases compare 1x and 4x energy at a folded third-harmonic frequency. This is a targeted synthetic measurement, not a guarantee that aliasing is eliminated for all audio material.


## Loudness and true-peak measurement

- ITU-R BS.1770-5 (November 2023): https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
  - Current in-force recommendation for programme loudness and true-peak measurement. Annex 2 describes a 4x oversampled FIR interpolation method for estimating continuous-time inter-sample peak level.
  - Sonora's current realtime limiter uses a 4x IIR interpolation estimate with an added 0.5 dB safety guard. It is explicitly treated as a conservative protection stage, not a claim of fully compliant BS.1770-5 true-peak measurement.
- EBU R 128, Version 5.0 (November 2023): https://tech.ebu.ch/publications/r128
  - Broadcast loudness normalisation recommendation using Programme Loudness, Loudness Range and Maximum True Peak Level descriptors. The appropriate target depends on the delivery specification; do not apply a broadcast target automatically to music streaming masters.
- AES Loudness Project resources: https://aes.org/resources/audio-topics/loudness-project/resources-and-references/
  - Index of current loudness and true-peak standards, including ITU-R BS.1770-5 and AES77-2023.

### Engineering consequence for Sonora

The Limiter's 4x IIR true-peak mode is a safety estimate only. It must not be presented as a standards-certified dBTP meter. Keep the final output trim at 0 dB when relying on the internal limiter ceiling and verify critical delivery masters with an independent BS.1770-compliant true-peak meter. The long-term roadmap should implement or integrate an Annex 2-compatible FIR/polyphase meter for final offline export analysis.


## Algorithmic reverberation

- CMU Intro to Computer Music, *13.4 All-pass filters*: https://www.cs.cmu.edu/~15322/book/ch13/04.html
  - Explains the Schroeder topology: feedback comb filters in parallel followed by all-pass filters in series to increase echo density.
  - Includes the RT60 feedback relation (g = 10^{-3D/(f_s T_{60})}).
- Csound manual, *freeverb*: https://csound.com/docs/manual/freeverb.html
  - Documents Jezar's Freeverb topology: eight parallel comb filters per channel followed by four serial allpass units, with right-channel delay offsets for stereo diffusion.
- Luca Spanedda, *Digital Reverberation in Faust*: https://github.com/LucaSpanedda/Digital_Reverberation_in_Faust
  - A public GitHub reference for implementing and comparing classic artificial reverb structures in Faust. Used as a design-reading reference only; no code is copied into Sonora.
- Sonora's Reverb is a Freeverb-derived algorithmic effect. It is not convolution and its Room/Hall/Plate/Spring names denote parameterised tonal/diffusion starting characters, not physical models or captured spaces.
- Unit tests measure dry-path transparency, impulse-tail energy, relative RT60 behaviour, maximum pre-delay support, stereo decorrelation, dynamic parameter stability and preset parameter validity.


## Tempo delay and feedback

- Cycling 'The History of the Delay Line': https://www.cycling74.com/tutorials/the-history-of-the-delay-line
  - Background on digital delay-line design and applications.
- Julius O. Smith, *Physical Audio Signal Processing*, Feedback Delay Networks: https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks.html
  - Reference for delay-line feedback, stability and decay behaviour.
- Sonora Delay uses one feedback delay line per channel, cross-feedback in ping-pong mode, and three read heads in multi-tap mode. This is an artistic tempo delay, not a physically modelled echo or room.
