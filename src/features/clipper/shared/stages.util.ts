export type ClipperStage =
  | "idle"
  | "trimming"
  | "uploading"
  | "transcribing"
  | "analyzing-faces"
  | "analyzing-subjects"
  | "preview"
  | "rendering"
  | "done"
  | "error";

export function isClipperPreviewReadyStage(stage: ClipperStage): boolean {
  return stage === "preview" || stage === "done" || stage === "rendering";
}

export function isClipperActivelyRendering(
  clipPreviews: Array<{ renderStatus: string }>,
  stage?: ClipperStage,
): boolean {
  if (stage === "rendering") return true;
  return clipPreviews.some(
    (preview) => preview.renderStatus === "queued" || preview.renderStatus === "rendering",
  );
}

export function clipperStageLabel(stage: ClipperStage): string {
  switch (stage) {
    case "idle":
      return "Awaiting upload";
    case "trimming":
      return "Choose clip window";
    case "uploading":
    case "transcribing":
    case "analyzing-faces":
    case "analyzing-subjects":
      return "Preparing";
    case "preview":
      return "Ready to render";
    case "rendering":
      return "Rendering";
    case "done":
      return "Exports ready";
    case "error":
      return "Needs attention";
    default:
      return "In progress";
  }
}
