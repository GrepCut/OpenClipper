import type { PipelineReporter } from "../../pipeline/reporter.util";
import type { ClipperPipelineState } from "../../shared/state.util";
import { patchPipelineState } from "./clipper-pipeline-state.util";

export function createReporter(
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>,
): PipelineReporter {
  return {
    stage: (stage, message) =>
      patchPipelineState(setState, (draft) => {
        draft.stage = stage;
        if (message !== undefined) draft.stageMessage = message;
      }),
    stageProgress: (ratio) =>
      patchPipelineState(setState, (draft) => {
        draft.stageProgress = ratio;
      }),
    faceProgress: (ratio) =>
      patchPipelineState(setState, (draft) => {
        draft.faceAnalysisProgress = ratio;
      }),
    subjectProgress: (ratio) =>
      patchPipelineState(setState, (draft) => {
        draft.subjectAnalysisProgress = ratio;
      }),
    eta: (seconds) =>
      patchPipelineState(setState, (draft) => {
        draft.analysisEtaSeconds = seconds;
      }),
    faces: (hasDetectedFaces, hasTwoSpeakers, sampleRevision) =>
      setState((prev) =>
        prev.hasDetectedFaces === hasDetectedFaces &&
        prev.hasTwoSpeakers === hasTwoSpeakers &&
        prev.faceSampleRevision === sampleRevision
          ? prev
          : {
              ...prev,
              hasDetectedFaces,
              hasTwoSpeakers,
              faceSampleRevision: sampleRevision,
            },
      ),
    renderProgress: (key, ratio) =>
      patchPipelineState(setState, (draft) => {
        draft.renderProgress[key] = ratio;
      }),
  };
}
