import { FFT, hannWindow } from '../dsp/fft';
import {
  BAND_CENTERS,
  SPECTRUM_FFT_SIZE,
  createSpectrumAccum,
  finalizeSpectrum,
  type SpectrumReport,
} from './spectrum';
import {
  createStereoSpectralAccum,
  finalizeStereoFromAccum,
  type StereoReport,
} from './stereo';

export interface SpectrumStereoAnalysis {
  spectrum: SpectrumReport;
  stereo: StereoReport;
}

function buildBinBandMap(sampleRate: number, fftSize: number): Int16Array {
  const map = new Int16Array(fftSize / 2 + 1);
  map.fill(-1);
  const binHz = sampleRate / fftSize;
  const sixthOctave = Math.pow(2, 1 / 6);
  for (let k = 1; k <= fftSize / 2; k++) {
    const frequency = k * binHz;
    for (let i = 0; i < BAND_CENTERS.length; i++) {
      const center = BAND_CENTERS[i];
      if (frequency >= center / sixthOctave && frequency < center * sixthOctave) {
        map[k] = i;
        break;
      }
    }
  }
  return map;
}

/**
 * Computes broadband spectrum and per-band stereo metrics from one pair of
 * stereo FFTs per analysis frame. The former independent spectrum and stereo
 * passes transformed the same L/R windows twice with the same FFT size/hop.
 */
export function analyzeSpectrumAndStereo(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): SpectrumStereoAnalysis {
  const n = Math.min(L.length, R.length);
  const spectrumAccum = createSpectrumAccum(sampleRate);
  const stereoAccum = createStereoSpectralAccum();
  if (n === 0) {
    return {
      spectrum: finalizeSpectrum(spectrumAccum),
      stereo: finalizeStereoFromAccum(L, R, sampleRate, stereoAccum),
    };
  }

  const fftSize = SPECTRUM_FFT_SIZE;
  const hop = fftSize / 2;
  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const reL = new Float64Array(fftSize);
  const imL = new Float64Array(fftSize);
  const reR = new Float64Array(fftSize);
  const imR = new Float64Array(fftSize);
  const binBand = buildBinBandMap(sampleRate, fftSize);
  const totalFrames = Math.max(0, Math.floor((n - fftSize) / hop) + 1);
  let frames = 0;

  for (let start = 0; start + fftSize <= n; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      reL[i] = L[start + i] * window[i];
      reR[i] = R[start + i] * window[i];
      imL[i] = 0;
      imR[i] = 0;
    }

    fft.forward(reL, imL);
    fft.forward(reR, imR);

    // One shared bin traversal updates both spectral accumulators.
    for (let k = 0; k <= fftSize / 2; k++) {
      const leftReal = reL[k];
      const leftImag = imL[k];
      const rightReal = reR[k];
      const rightImag = imR[k];
      const leftPower = leftReal * leftReal + leftImag * leftImag;
      const rightPower = rightReal * rightReal + rightImag * rightImag;
      spectrumAccum.power[k] += (leftPower + rightPower) * 0.5;

      const band = binBand[k];
      if (band < 0) continue;

      const midReal = (leftReal + rightReal) * 0.5;
      const midImag = (leftImag + rightImag) * 0.5;
      const sideReal = (leftReal - rightReal) * 0.5;
      const sideImag = (leftImag - rightImag) * 0.5;
      stereoAccum.midPower[band] += midReal * midReal + midImag * midImag;
      stereoAccum.sidePower[band] += sideReal * sideReal + sideImag * sideImag;
      stereoAccum.crossRe[band] += leftReal * rightReal + leftImag * rightImag;
      stereoAccum.leftPower[band] += leftPower;
      stereoAccum.rightPower[band] += rightPower;
    }

    frames++;
    if (onProgress && ((frames & 0x7f) === 0 || frames === totalFrames)) {
      onProgress(0.8 * (frames / Math.max(1, totalFrames)));
    }
  }

  spectrumAccum.frames = frames;
  stereoAccum.frames = frames;

  return {
    spectrum: finalizeSpectrum(spectrumAccum),
    stereo: finalizeStereoFromAccum(
      L,
      R,
      sampleRate,
      stereoAccum,
      (fraction) => onProgress?.(0.8 + fraction * 0.2),
    ),
  };
}
