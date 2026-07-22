import type { PipelineReporter } from "../../pipeline/reporter.util";
import type { ClipperPipelineState } from "../../shared/state.util";

export function createReporter(
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>,
): PipelineReporter {
  return {
    stage: (stage, message) =>
      setState((prev) => ({
        ...prev,
        stage,
        ...(message !== undefined ? { stageMessage: message } : {}),
      })),
    stageProgress: (ratio) => setState((prev) => ({ ...prev, stageProgress: ratio })),
    faceProgress: (ratio) => setState((prev) => ({ ...prev, faceAnalysisProgress: ratio })),
    subjectProgress: (ratio) => setState((prev) => ({ ...prev, subjectAnalysisProgress: ratio })),
    eta: (seconds) => setState((prev) => ({ ...prev, analysisEtaSeconds: seconds })),
    faces: (hasDetectedFaces, hasTwoSpeakers, sampleRevision) =>
      setState((prev) =>
        prev.hasDetectedFaces === hasDetectedFaces &&
        prev.hasTwoSpeakers === hasTwoSpeakers &&
        prev.faceSampleRevision === sampleRevision
          ? prev
          : { ...prev, hasDetectedFaces, hasTwoSpeakers, faceSampleRevision: sampleRevision },
      ),
    renderProgress: (key, ratio) =>
      setState((prev) => ({
        ...prev,
        renderProgress: { ...prev.renderProgress, [key]: ratio },
      })),
  };
}
