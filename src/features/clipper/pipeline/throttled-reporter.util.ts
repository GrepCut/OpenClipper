import type { PipelineReporter } from "./reporter.util";

const FLUSH_INTERVAL_MS = 150;

/**
 * Koalescencja wysokoczęstotliwościowych aktualizacji progresu do jednego
 * commitu co ~150 ms. Render N formatów równolegle raportuje postęp per
 * zdekodowana klatka (N × fps wywołań/s) — bez throttlingu każde z nich to
 * osobny setState i re-render całego widoku eksportów, konkurujący o główny
 * wątek z samym renderowaniem.
 *
 * Zdarzenia dyskretne (`stage`, `faces`) oraz wartości terminalne progresu
 * (null / 1) najpierw opróżniają bufor, potem przechodzą natychmiast — zmiany
 * etapów i zakończenia nie są opóźniane. Settery wywoływane razem w jednym
 * flushu i tak skleja automatyczne batchowanie Reacta 18 w jeden render.
 */
export function createThrottledReporter(inner: PipelineReporter): PipelineReporter {
  let pendingStageProgress: number | null | undefined;
  let pendingStageDetail: { label: string | null; progress: number | null } | undefined;
  let pendingFaceProgress: number | null | undefined;
  let pendingSubjectProgress: number | null | undefined;
  let pendingEta: number | null | undefined;
  const pendingRender = new Map<string, number | null>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingStageProgress !== undefined) {
      inner.stageProgress(pendingStageProgress);
      pendingStageProgress = undefined;
    }
    if (pendingStageDetail !== undefined) {
      inner.stageDetail(pendingStageDetail.label, pendingStageDetail.progress);
      pendingStageDetail = undefined;
    }
    if (pendingFaceProgress !== undefined) {
      inner.faceProgress(pendingFaceProgress);
      pendingFaceProgress = undefined;
    }
    if (pendingSubjectProgress !== undefined) {
      inner.subjectProgress(pendingSubjectProgress);
      pendingSubjectProgress = undefined;
    }
    if (pendingEta !== undefined) {
      inner.eta(pendingEta);
      pendingEta = undefined;
    }
    if (pendingRender.size > 0) {
      for (const [key, ratio] of pendingRender) {
        inner.renderProgress(key, ratio);
      }
      pendingRender.clear();
    }
  };

  const schedule = () => {
    if (timer == null) {
      timer = setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  };

  const isTerminal = (ratio: number | null) => ratio == null || ratio >= 1;

  return {
    stage: (stage, message) => {
      flush();
      inner.stage(stage, message);
    },
    faces: (hasDetectedFaces, hasTwoSpeakers, sampleRevision) => {
      flush();
      inner.faces(hasDetectedFaces, hasTwoSpeakers, sampleRevision);
    },
    stageProgress: (ratio) => {
      pendingStageProgress = ratio;
      if (isTerminal(ratio)) flush();
      else schedule();
    },
    stageDetail: (label, progress) => {
      const prev = pendingStageDetail;
      pendingStageDetail = { label, progress };
      // Paint immediately on first update, label change, indeterminate, clear, or completion.
      if (
        label == null ||
        progress == null ||
        progress >= 1 ||
        prev === undefined ||
        prev.label !== label
      ) {
        flush();
      } else {
        schedule();
      }
    },
    faceProgress: (ratio) => {
      pendingFaceProgress = ratio;
      if (isTerminal(ratio)) flush();
      else schedule();
    },
    subjectProgress: (ratio) => {
      pendingSubjectProgress = ratio;
      if (isTerminal(ratio)) flush();
      else schedule();
    },
    eta: (seconds) => {
      pendingEta = seconds;
      if (seconds == null || seconds <= 0) flush();
      else schedule();
    },
    renderProgress: (key, ratio) => {
      pendingRender.set(key, ratio);
      if (isTerminal(ratio)) flush();
      else schedule();
    },
  };
}
