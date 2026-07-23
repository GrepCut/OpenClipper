import type { ClipperLayoutMode, ImportanceRegionSample, NormalizedBox } from "../../../shared/smart-crop.util";
import { requiredRegions } from "./arbiter.util";
import { buildGroupUnionLayout } from "./group-union-layout.util";
import type { SemanticFramingParams, VisibilityFramingState } from "../../types/autoflip-layout.types";
import { visibilityConstrainedViewport } from "./visibility-framing.util";
import {
  centerViewportOnBox,
  cropAroundBox,
  expandBox,
  strictAspectViewport,
  unionAll,
} from "./viewport-geometry.util";

export function buildViewports(
  mode: ClipperLayoutMode,
  importance: ImportanceRegionSample,
  fallbackCrop: NormalizedBox,
  sourceAspect: number,
  targetAspect: number,
  framing?: SemanticFramingParams,
  visibilityState?: VisibilityFramingState,
  cut = false,
  allowGroupUnion = false,
  groupUnionMeta?: { used: boolean },
): NormalizedBox[] {
  const required = requiredRegions(importance);
  if (
    allowGroupUnion
    && mode === "single-crop"
    && required.length >= 3
    && required[0]?.kind === "action"
  ) {
    const groupUnion = buildGroupUnionLayout(
      required.map((region) => region.contentBox),
      sourceAspect,
      targetAspect,
    );
    if (groupUnion?.reasonCode === "group-union-crop") {
      if (groupUnionMeta) groupUnionMeta.used = true;
      return groupUnion.viewports;
    }
  }
  if (mode === "single-crop" || !required.length) {
    const primary = required.find((region) => region.role === "primary") ?? required[0];
    const legacyViewport = strictAspectViewport(fallbackCrop, sourceAspect, targetAspect);
    if (!primary) return [legacyViewport];
    if (!framing) return [centerViewportOnBox(legacyViewport, primary.box)];
    const legacySemanticViewport = centerViewportOnBox(legacyViewport, primary.box);
    if (framing.visibilityConstrained && visibilityState) {
      return [visibilityConstrainedViewport(
        importance,
        legacySemanticViewport,
        sourceAspect,
        targetAspect,
        framing,
        visibilityState,
        cut,
      )];
    }
    const target = framing.targetBoxSource === "contentBox" ? primary.contentBox : primary.box;
    return [cropAroundBox(
      target,
      sourceAspect,
      targetAspect,
      framing.minimumScale,
      framing.padding,
      framing.centerYFraction,
    )];
  }
  if (mode === "split" && required.length === 2) {
    const panelAspect = targetAspect * 2;
    return [
      cropAroundBox(required[0]!.contentBox, sourceAspect, panelAspect),
      cropAroundBox(required[1]!.contentBox, sourceAspect, panelAspect),
    ];
  }
  if (mode === "split" && required.length >= 3) {
    const primary = required.find((region) => region.role === "primary") ?? required[0]!;
    const secondary = required.filter((region) => region.id !== primary.id)
      .sort((a, b) => (a.contentBox.x + a.contentBox.width / 2) - (b.contentBox.x + b.contentBox.width / 2));
    const ordered = [primary, ...secondary].slice(0, 3);
    const aspects = targetAspect < 1
      ? [targetAspect * 2, targetAspect, targetAspect]
      : [targetAspect * 0.6, targetAspect * 0.8, targetAspect * 0.8];
    return ordered.map((region, index) => cropAroundBox(region.contentBox, sourceAspect, aspects[index]!));
  }
  const union = unionAll(required.map((region) => region.contentBox)) ?? required[0]!.contentBox;
  return [expandBox(union, 0.12)];
}
