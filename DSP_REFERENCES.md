# DSP Reference Notes

This file records public technical references reviewed while improving Sonora's processors. They are design and verification references, not automatic dependencies. No third-party source code is copied into the TypeScript engine by these upgrades.

## Parametric and dynamic equalization

- [W3C — Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/): RBJ biquad design equations for peaking, shelving, low/high-pass, notch and band-pass filters. Relevant to the Parametric EQ and the dynamic bell sections.
- [JUCE — IIR filter class documentation](https://docs.juce.com/master/classjuce_1_1dsp_1_1IIR_1_1Filter.html): reference for IIR filter processing, state reset and coefficient lifecycle.
- [JUCE — IIR filter implementation](https://github.com/juce-framework/JUCE/blob/master/modules/juce_dsp/processors/juce_IIRFilter.h): open implementation reference for coefficient generation, filter state and frequency-response inspection.
- [JUCE — DSP introduction](https://juce.com/tutorials/tutorial_dsp_introduction/): background on FIR/IIR characteristics, including stability and efficiency trade-offs.

## Dynamic processors and sidechain architecture

- [LSP Plugins — lsp-dsp-units](https://github.com/lsp-plugins/lsp-dsp-units): C++ DSP collection listing dynamic processors, dynamic filters, equalizers, signal-envelope functions, sidechain control, interpolation and tests across multiple platforms. Useful as an independent architecture and terminology reference.
- [LSP DSP units README](https://github.com/lsp-plugins/lsp-dsp-units/blob/master/README.md): describes the modules and usage model; no direct TypeScript port is assumed.

## Licensing and integration policy

- Sonora currently keeps its DSP in TypeScript and shares one `ProjectRenderer` between realtime monitoring and offline rendering.
- These references do not become runtime dependencies merely because they are cited here.
- The LSP DSP units repository contains both `COPYING` (GNU GPL v3) and `COPYING.LESSER` (GNU LGPL v3) license texts. The presence of both files is not enough to determine the license of every source file: inspect the exact file headers and project licensing terms before considering any reuse.
- JUCE has its own GPL/commercial licensing model. Documentation and source are being used for technical study only; do not transplant code without a separate license review.
- Prefer a clean-room TypeScript implementation informed by documented algorithms and verified against synthetic signals. Any future dependency or port requires a documented license and architecture review first.

## Dynamic EQ implementation decisions

- Detector filters operate on signed audio before peak/RMS measurement. Rectifying the broadband signal before band selection is avoided because it changes its spectrum and can cause energy outside the intended detector band to influence detection.
- Each of the four bands has independent left/right detector and envelope state. Stereo link blends each channel detector towards the stronger channel, with 0% dual-mono and 100% common gain reduction.
- External sidechain keys pass through each band's own detector filter. The programme audio remains the signal being equalized; the external key changes the detector input only.
- The detector's ratio, soft knee, maximum cut and attack/release are separate controls. Per-band meters report the actual reduction calculated from the gain envelope.
- The algorithm remains an editable downward dynamic bell implementation; it is not represented as a complete hardware emulation or a spectral-dynamics processor.