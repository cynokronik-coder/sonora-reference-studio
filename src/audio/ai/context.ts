import type { AnalysisReport } from '../analysis/analyze';
import type { MatchPlan } from '../analysis/match';
import { PROCESSOR_DEFINITIONS } from '../dsp/registry';
import type { AudioAssetMeta, ProjectState } from '../model/types';

interface AssistantContextOptions {
  project: ProjectState;
  assets: AudioAssetMeta[];
  analyses: Record<string, AnalysisReport>;
  mode: 'beginner' | 'advanced';
  scope: 'master' | 'track';
  selectedTrackId: string | null;
  matchPlan: MatchPlan | null;
  lastRenderStats: {
    lufs: number;
    truePeakDb: number;
    samplePeakDb: number;
    lra: number;
    crestDb: number;
    duration: number;
  } | null;
}

function processorSummary(processors: ProjectState['master']['processors']) {
  return processors.map((processor) => ({
    id: processor.id,
    type: processor.type,
    enabled: processor.enabled,
    note: processor.note ?? '',
    parameters: processor.params,
  }));
}

function reportSummary(report: AnalysisReport) {
  return {
    sampleRate: report.sampleRate,
    duration: report.duration,
    loudness: {
      integratedLufs: report.loudness.integratedLufs,
      momentaryMaxLufs: report.loudness.momentaryMaxLufs,
      shortTermMaxLufs: report.loudness.shortTermMaxLufs,
      loudnessRangeLu: report.loudness.lra,
      truePeakDbtp: report.loudness.truePeakDb,
      samplePeakDbfs: report.loudness.samplePeakDb,
      rmsDbfs: report.loudness.rmsDb,
      crestDb: report.loudness.crestDb,
      plrDb: report.loudness.plrDb,
    },
    spectrum: {
      bands: report.spectrum.bands.map((band) => ({
        centerHz: band.center,
        levelDb: band.db,
        relativeDb: band.relativeDb,
      })),
      centroidHz: report.spectrum.centroidHz,
      rolloffHz: report.spectrum.rolloffHz,
      tiltDbPerOctave: report.spectrum.tiltDbPerOct,
      flatness: report.spectrum.flatness,
      lowEnergyDb: report.spectrum.lowEnergyDb,
      highEnergyDb: report.spectrum.highEnergyDb,
      resonances: report.resonances.slice(0, 8),
    },
    stereo: {
      widthDb: report.stereo.widthDb,
      correlation: report.stereo.correlation,
      balanceDb: report.stereo.balanceDb,
      monoCompatibilityPercent: report.stereo.monoCompatibility,
      lowSideRatioDb: report.stereo.lowSideRatioDb,
    },
    rhythm: {
      estimatedTempoBpm: report.rhythm.tempoBpm,
      tempoConfidence: report.rhythm.beatConfidence,
      punchScore: report.rhythm.punchScore,
      attackSharpness: report.rhythm.attackSharpness,
    },
    sections: report.sections.slice(0, 8).map((section) => ({
      label: section.label,
      startSeconds: section.start,
      endSeconds: section.end,
      integratedLufs: section.lufs,
      crestDb: section.crestDb,
      stereoWidthDb: section.widthDb,
    })),
    warnings: report.warnings,
  };
}

/** Create a compact, metadata-only view of the local project for AI reasoning. */
export function buildAssistantContext(options: AssistantContextOptions): Record<string, unknown> {
  const {
    project, assets, analyses, mode, scope, selectedTrackId, matchPlan, lastRenderStats,
  } = options;
  const trackIds = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
  const relevantAssetIds = [...new Set([
    ...project.targetAssetIds,
    ...project.referenceAssetIds,
    ...trackIds,
  ])].slice(0, 8);
  const relevantAssets = assets.filter((asset) => relevantAssetIds.includes(asset.id));
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId);
  const selectedChain = scope === 'master' ? project.master.processors : selectedTrack?.processors ?? [];

  return {
    interfaceMode: mode,
    selectedScope: scope,
    selectedTrackId,
    project: {
      id: project.id,
      name: project.name,
      sampleRate: project.sampleRate,
      tempoBpm: project.tempo,
      targetLufs: project.targetLufs,
      targetTruePeakDbtp: project.targetTruePeak,
      tracks: project.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        kind: track.kind,
        muted: track.muted,
        soloed: track.soloed,
        volumeDb: track.volumeDb,
        pan: track.pan,
        clipCount: track.clips.length,
        sourceAssetIds: [...new Set(track.clips.map((clip) => clip.assetId))],
        processors: processorSummary(track.processors),
      })),
      buses: project.buses.map((bus) => ({
        id: bus.id,
        name: bus.name,
        muted: bus.muted,
        volumeDb: bus.volumeDb,
        processors: processorSummary(bus.processors),
      })),
      master: {
        volumeDb: project.master.volumeDb,
        processors: processorSummary(project.master.processors),
      },
      targetAssetIds: project.targetAssetIds,
      referenceAssetIds: project.referenceAssetIds,
      matchSettings: {
        intensity: project.match.intensity,
        frequencyBalance: project.match.frequencyBalance,
        dynamics: project.match.dynamics,
        loudness: project.match.loudness,
        stereoWidth: project.match.stereoWidth,
        targetSection: project.match.targetSection,
        referenceSection: project.match.referenceSection,
      },
    },
    selectedChain: processorSummary(selectedChain),
    assets: relevantAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      role: asset.role,
      durationSeconds: asset.duration,
      sampleRate: asset.sampleRate,
      channels: asset.channels,
      analyzed: Boolean(analyses[asset.id]),
    })),
    analyses: relevantAssetIds
      .filter((id) => Boolean(analyses[id]))
      .map((id) => ({
        assetId: id,
        assetName: relevantAssets.find((asset) => asset.id === id)?.name ?? 'Audio asset',
        report: reportSummary(analyses[id]),
      })),
    latestMasterRender: lastRenderStats,
    referenceMatchPlan: matchPlan ? {
      proposalCount: matchPlan.proposals.length,
      proposals: matchPlan.proposals.slice(0, 8).map((proposal) => ({
        category: proposal.category,
        processorType: proposal.processorType,
        reason: proposal.reason,
        expected: proposal.expected,
        confidence: proposal.confidence,
      })),
      warnings: matchPlan.warnings,
    } : null,
    processorRegistry: PROCESSOR_DEFINITIONS.map((definition) => ({
      type: definition.type,
      name: definition.name,
      category: definition.category,
      purpose: definition.purpose,
      description: definition.description,
      parameters: definition.params.map((parameter) => ({
        key: parameter.key,
        label: parameter.label,
        kind: parameter.kind,
        min: parameter.min ?? null,
        max: parameter.max ?? null,
        default: parameter.default,
        unit: parameter.unit ?? '',
        options: parameter.options ?? [],
        advanced: Boolean(parameter.advanced),
      })),
    })),
    importantLimitations: [
      'The model receives metadata and computed measurements only, never the audio waveform.',
      'A stereo master cannot be separated into independent vocals, drums or bass by this assistant.',
      'Only processors and parameters listed in processorRegistry are executable.',
      'AI proposals are previews and require explicit user approval.',
    ],
  };
}
