import type {
  ClipperLayoutMode,
  ClipperLayoutSample,
  ClipperLayoutTrack,
} from "../../../shared/smart-crop.util";
import {
  DEFAULT_ARBITER_PARAMS,
  decideLayoutStrategy,
  coveredFraction,
  importanceAtTime,
  precedingIndex,
  proposalScore,
  requiredRegions,
} from "./arbiter.util";
import {
  createVisibilityControllerState,
  planVisibilityRescue,
} from "./visibility-controller.util";
import type { BuildLayoutTracksInput } from "../../types/autoflip-layout.types";
import { groupUnionLexicographicOk } from "./group-union-layout.util";
import { rawMode } from "./layout-mode.util";
import { createVisibilityFramingState } from "./visibility-framing.util";
import { buildViewports } from "./viewport-builder.util";
import { smoothLayoutTrackSamples } from "./trajectory-smoothing.util";
import { bridgeTransientSplitGaps } from "./offline-split-confirmation.util";
import {
  isShortSelectedSplitRun,
  shouldKeepShortSplitRun,
  withShortSplitConfidenceReason,
} from "./short-split-policy.util";

const EPSILON = 1e-9;

/** Remove split runs too short to be meaningful in the rendered video. */
function removeShortSplitRuns(samples: ClipperLayoutSample[]): ClipperLayoutSample[] {
  const stabilized = samples.map((sample) => ({ ...sample, viewports: [...sample.viewports] }));
  for (let index = 0; index < stabilized.length; index++) {
    const sample = stabilized[index]!;
    if (sample.mode !== "split" || !isShortSelectedSplitRun(stabilized, index)) continue;
    if (shouldKeepShortSplitRun(stabilized, index)) {
      stabilized[index] = withShortSplitConfidenceReason(sample);
      continue;
    }
    sample.mode = "single-crop";
    sample.strategy = "legacy-baseline";
    sample.viewports = sample.baselineViewports?.map((viewport) => ({ ...viewport })) ?? [sample.viewports[0]!];
    sample.reasonCodes = [...(sample.reasonCodes ?? []), "split-too-short"];
  }
  return stabilized;
}

/** Builds stable format-aware render decisions over the smooth legacy camera path. */
export function buildLayoutTracks(input: BuildLayoutTracksInput): Record<string, ClipperLayoutTrack> {
  const sourceAspect = input.frameWidth / Math.max(1, input.frameHeight);
  const arbiterParams = input.arbiterParams ?? DEFAULT_ARBITER_PARAMS;
  return Object.fromEntries(Object.entries(input.aspectTracks).map(([formatId, aspectTrack]) => {
    const visibilityState = createVisibilityFramingState();
    const visibilityControllerState = createVisibilityControllerState();
    const samples: ClipperLayoutSample[] = aspectTrack.samples.map((cropSample) => {
      const importance = importanceAtTime(input.importanceSamples, cropSample.t);
      const required = requiredRegions(importance);
      const baselineMode: ClipperLayoutMode = "single-crop";
      const baselineViewports = [cropSample.crop];
      const importanceIndex = precedingIndex(input.importanceSamples, cropSample.t);
      let desiredMode = rawMode(importance, sourceAspect, aspectTrack.targetAspectRatio);
      const groupUnionMeta = { used: false };
      let semanticViewports = buildViewports(
        desiredMode,
        importance,
        cropSample.crop,
        sourceAspect,
        aspectTrack.targetAspectRatio,
        input.semanticFramingParams,
        visibilityState,
        Boolean(cropSample.cut),
        Boolean(arbiterParams.allowGroupUnion),
        groupUnionMeta,
      );
      if (desiredMode === "split" && semanticViewports.length < 2) {
        desiredMode = "single-crop";
      }
      if (groupUnionMeta.used) {
        const fallbackViewports = buildViewports(
          desiredMode,
          importance,
          cropSample.crop,
          sourceAspect,
          aspectTrack.targetAspectRatio,
          input.semanticFramingParams,
          visibilityState,
          Boolean(cropSample.cut),
          false,
        );
        if (!groupUnionLexicographicOk(semanticViewports[0]!, fallbackViewports[0]!, required)) {
          semanticViewports = fallbackViewports;
        }
      }
      const visibilityDecision = input.visibilityControllerParams?.enabled
        ? planVisibilityRescue({
            samples: input.importanceSamples,
            importanceIndex,
            baselineViewport: baselineViewports[0]!,
            sourceAspect,
            targetAspect: aspectTrack.targetAspectRatio,
            state: visibilityControllerState,
            params: input.visibilityControllerParams,
          })
        : null;
      if (visibilityDecision) {
        desiredMode = visibilityDecision.mode;
        semanticViewports = visibilityDecision.viewports;
      }
      const coverageRegions = visibilityDecision?.envelopes ?? required;
      const baselineScore = proposalScore(baselineViewports, coverageRegions);
      const semanticScore = proposalScore(semanticViewports, coverageRegions);
      const baselineCoverage = coverageRegions.length
        ? Math.min(...coverageRegions.map((region) => Math.max(...baselineViewports.map((viewport) => coveredFraction(viewport, region.contentBox)))))
        : 1;
      const decision = decideLayoutStrategy({
        desiredMode,
        baselineScore,
        semanticScore,
        controllerReasonCodes: visibilityDecision?.reasonCodes,
        baselineCoverage,
      }, arbiterParams);
      return {
        t: cropSample.t,
        mode: decision.selectSemantic ? desiredMode : baselineMode,
        strategy: decision.strategy,
        viewports: decision.selectSemantic ? semanticViewports : baselineViewports,
        candidateMode: desiredMode,
        candidateViewports: semanticViewports,
        baselineViewports,
        primaryRegionId: required.find((region) => region.role === "primary")?.id,
        requiredRegionIds: required.map((region) => region.id),
        panelSubjects: decision.selectSemantic && desiredMode === "split"
          ? visibilityDecision?.panelSubjects?.map((subject) => ({
              id: subject.id,
              focusBox: { ...subject.focusBox },
            }))
          : undefined,
        baselineScore,
        semanticScore,
        decisionConfidence: decision.decisionConfidence,
        reasonCodes: decision.reasonCodes,
        targetEvidence: importance.targetEvidence,
        candidateVariants: visibilityDecision?.variants,
        baselineRequiredCoverage: visibilityDecision?.baselineCoverage,
        selectedRequiredCoverage: decision.selectSemantic
          ? visibilityDecision?.selectedCoverage
          : visibilityDecision?.baselineCoverage,
        visibilityRisk: visibilityDecision?.visibilityRisk,
        qualityTelemetry: visibilityDecision ? {
          containDutyCandidate: false,
          subjectDisplayHeightFractions: coverageRegions.map((region) => Math.min(1, Math.max(
            ...((decision.selectSemantic ? semanticViewports : baselineViewports).map((viewport) =>
              region.contentBox.height / Math.max(EPSILON, viewport.height))),
          ))),
        } : undefined,
        coverageBoxes: coverageRegions.map((region) => ({ ...region.contentBox })),
        cut: cropSample.cut,
        solidBackgroundColor: cropSample.solidBackgroundColor,
      };
    });
    const denoisedSamples = bridgeTransientSplitGaps(
      samples,
      input.visibilityControllerParams?.splitExitStableSec ?? 0,
    );
    const smoothedSamples = smoothLayoutTrackSamples(denoisedSamples);
    return [formatId, { targetAspectRatio: aspectTrack.targetAspectRatio, samples: removeShortSplitRuns(smoothedSamples) }];
  }));
}
