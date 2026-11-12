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
