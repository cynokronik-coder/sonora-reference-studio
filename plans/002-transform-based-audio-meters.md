# 002 — Render audio meter levels with transforms

- **Status**: TODO
- **Commit**: 4293922
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, small to medium

## Problem

The live meter fills animate their dimensions. The LevelMeter and GainReductionMeter are small, but are repeated across Studio, Mixer, Rack and Mastering and are updated from the realtime audio meter stream. Animating height can trigger layout and paint work for each update.

The current LevelMeter fill in **src/ui/viz.tsx:143–145** is:

~~~tsx
<div
  className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
  style={{ height: `${normalized * 100}%`, background: `linear-gradient(to top, ${color}55, ${color})` }}
/>
~~~

The current GainReductionMeter fill in **src/ui/viz.tsx:163–165** is:

~~~tsx
<div
  className="absolute left-0 right-0 top-0 bg-signal-amber/80 transition-[height] duration-75"
  style={{ height: `${amount * 100}%` }}
/>
~~~

Realtime meter messages are received through **src/ui/viz.tsx:11–15** and originate from AudioWorklet meter messages. Keep that data path and the engine's signal calculations unchanged.

## Target

Keep the existing meter geometry, colours, normalized values, peak marker and update cadence. Animate only the fill transform.

For LevelMeter, keep the fill anchored to the bottom and give it a fixed full height. Replace the changing height with vertical scaling:

~~~tsx
<div
  className="absolute bottom-0 left-0 right-0 h-full origin-bottom transition-transform duration-75 ease-linear"
  style={{
    transform: `scaleY(${normalized})`,
    transformOrigin: 'bottom',
    background: `linear-gradient(to top, ${color}55, ${color})`,
  }}
/>
~~~

For GainReductionMeter, keep the fill anchored to the top and replace its changing height with vertical scaling:

~~~tsx
<div
  className="absolute left-0 right-0 top-0 h-full origin-top bg-signal-amber/80 transition-transform duration-75 ease-linear"
  style={{
    transform: `scaleY(${amount})`,
    transformOrigin: 'top',
  }}
/>
~~~

The 75 ms duration is retained as the current meter response budget; linear is used so successive measured values do not acquire an artificial ease-in/ease-out ramp. Do not add permanent will-change declarations. Layer promotion must be validated rather than assumed.

The exported MiniMeter implementation at **src/ui/viz.tsx:170–177** has no confirmed call site in the currently traced UI. Leave it unchanged unless a real caller is found during implementation.

## Repo conventions to follow

- **src/ui/viz.tsx** owns the shared visual meter primitives.
- **src/audio/engine/realtime.ts** and **src/audio/engine/engine.worklet.ts** own the actual meter data. They are not presentation-layer files and are out of scope.
- **src/ui/Mixer.tsx**, **src/screens/Studio.tsx**, **src/ui/Rack.tsx** and **src/screens/Mastering.tsx** consume the shared meter components. Keep their APIs unchanged.
- The AudioWorklet must remain the source of measured values. Never fabricate, interpolate or clamp a different audio value merely to improve visual smoothness.

## Steps

1. Open **src/ui/viz.tsx** and inspect the LevelMeter and GainReductionMeter implementations.
2. Change the LevelMeter fill to a fixed height: 100% element and set transform: scaleY(normalized) with transform-origin: bottom.
3. Replace transition-[height] with transition-transform duration-75 ease-linear.
4. Change the GainReductionMeter fill to a fixed height: 100% element and set transform: scaleY(amount) with transform-origin: top.
5. Replace its transition-[height] with transition-transform duration-75 ease-linear.
6. Preserve all wrapper sizes, clipping, peak-marker placement, meter colours and function signatures.
7. Do not add will-change unless browser profiling proves it is necessary for these specific bars.

## Boundaries

- Do NOT edit **src/audio/engine/engine.worklet.ts**, **src/audio/engine/realtime.ts**, **src/audio/dsp/** or any processor.
- Do NOT change meter update frequency, DSP smoothing, peak-hold behavior, gain-reduction values or the useMeters subscription.
- Do NOT animate wrapper dimensions or the peak marker.
- Do NOT change LevelMeter or GainReductionMeter props.
- Do NOT change MiniMeter without first proving it has a live caller.
- Do NOT add dependencies.
- If the current implementations no longer match the excerpts because the source has changed since commit 4293922, STOP and report the drift.

## Verification

- **Mechanical**: run npm run typecheck, npm test and npm run build. All must pass.
- **Feel check**: play audio with sustained bass, sharp transients and quiet passages. Check the Studio master meter, Mixer channel meters and Mastering meters.
- Confirm LevelMeter still fills upward from the bottom and its peak line remains at the measured peak.
- Confirm GainReductionMeter fills downward from the top and remains numerically consistent with the displayed reduction.
- Test silence, near-zero values, values near full scale and rapid transients.
- Use Chrome DevTools Performance and Paint Flashing with a session containing multiple tracks and processor meters. Verify repeated meter updates no longer perform layout because the fill's changing dimension; check frame time while playback is active.
- Inspect the Layers panel before adding any will-change. Do not force promotion for every meter by default.
- **Done when**: displayed measurements are unchanged, fills move in the correct direction, meter response remains natural, layout work from changing fill dimensions is removed, and mechanical checks pass.
