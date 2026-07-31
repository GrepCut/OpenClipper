import { useRef } from "react";

import { isClipperStepCompleted } from "../../persistence/pipeline-api.util";
import { normalizeAutoPartsSegmentLengthSec } from "../../engine/segmentation";
import { createThrottledReporter } from "../../pipeline/throttled-reporter.util";
import type { ClipperPipelineState } from "../../shared/state.util";
import type { ClipperLoadedProject } from "../use-clipper-project-loader.hook";
import type { ClipperPipelineRefs } from "./clipper-pipeline.types";
import { createReporter } from "./pipeline-reporter.util";

/** Initializes shared pipeline refs (must run inside a React hook). */
export function usePipelineRefs(
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>,
  loaded: ClipperLoadedProject | null,
): ClipperPipelineRefs {
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const sessionRef = useRef<ClipperPipelineRefs["sessionRef"]["current"]>(null);
  const activeClipIndexRef = useRef(0);
  const metadataRef = useRef(
    loaded?.metadata ?? {
      version: 1 as const,
      stage: "idle" as const,
      sourceMediaFileId: null,
      clipStart: 0,
      clipEnd: null,
    },
  );
  const resumeStartedRef = useRef(false);
  const loadedResumeKeyRef = useRef<string | null>(null);
  const aiClipsMetaRef = useRef<ClipperPipelineRefs["aiClipsMetaRef"]["current"]>([]);
  const reporterRef = useRef(createThrottledReporter(createReporter(setState)));

  return {
    abortRef,
    previewUrlsRef,
    sessionRef,
    activeClipIndexRef,
    metadataRef,
    resumeStartedRef,
    loadedResumeKeyRef,
    aiClipsMetaRef,
    reporterRef,
  };
}

export function deriveRangeLocked(loaded: ClipperLoadedProject | null): boolean {
  return loaded ? isClipperStepCompleted(loaded.steps, "confirm_range") : false;
}

export function deriveAutoPartsSegmentLengthSec(loaded: ClipperLoadedProject | null) {
  return normalizeAutoPartsSegmentLengthSec(loaded?.metadata.autoPartsSegmentLengthSec);
}
