import React from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle2, Circle } from "lucide-react";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import type { ClipperPipelineState } from "../shared/state";
import { ClipperProgressBar } from "./ClipperProgressBar";

interface ClipperProcessingProps {
  state: ClipperPipelineState;
}

const STEPS = [
  { key: "uploading", label: "Upload & prepare" },
  { key: "transcribing", label: "Transcribe speech" },
  { key: "analyzing", label: "Detect faces & track action" },
  { key: "preview", label: "Preview formats" },
] as const;

const STAGE_ORDER = [
  "trimming",
  "uploading",
  "transcribing",
  "analyzing",
  "preview",
  "done",
] as const;

type UiStepKey = (typeof STEPS)[number]["key"];

function uiStepKeyForStage(stage: ClipperPipelineState["stage"]): UiStepKey | "trimming" | "done" | "error" | "rendering" {
  if (stage === "analyzing-faces" || stage === "analyzing-subjects") return "analyzing";
  return stage;
}

function combinedAnalysisProgress(state: ClipperPipelineState): number {
  const face = state.faceAnalysisProgress ?? 0;
  const subject = state.subjectAnalysisProgress ?? 0;
  if (state.stage === "analyzing-subjects") {
    return 0.92 + subject * 0.08;
  }
  return face * 0.92;
}

function formatEta(seconds: number | null): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 1) return undefined;
  if (seconds < 60) return `~${Math.round(seconds)}s remaining`;
  return `~${Math.round(seconds / 60)}m remaining`;
}

function stepStatus(
  stepKey: UiStepKey,
  current: ClipperPipelineState["stage"],
): "done" | "active" | "pending" {
  const stepIndex = STAGE_ORDER.indexOf(stepKey);
  const currentUi = uiStepKeyForStage(current);
  const currentIndex = STAGE_ORDER.indexOf(
    currentUi as (typeof STAGE_ORDER)[number],
  );

  if (current === "done" || currentIndex > stepIndex) return "done";
  if (currentUi === stepKey || (current === "trimming" && stepKey === "uploading")) return "active";
  return "pending";
}

export const ClipperProcessing: React.FC<ClipperProcessingProps> = ({ state }) => {
  const { theme } = useClipperUi();

  return (
    <VStack align="stretch" gap={6}>
      {state.clipDuration != null && (
        <Text fontSize="sm" color={theme.text.muted}>
          Clipping first {Math.round(state.clipDuration)}s
          {state.sourceFileName ? ` of ${state.sourceFileName}` : ""}
        </Text>
      )}

      <VStack align="stretch" gap={3}>
        {STEPS.map((step) => {
          const status = stepStatus(step.key, state.stage);
          return (
            <HStack key={step.key} gap={3}>
              {status === "done" ? (
                <CheckCircle2 size={20} color={clipperTheme.accentLight} />
              ) : status === "active" ? (
                <Circle size={20} color={clipperTheme.accentLight} fill={clipperTheme.accentLight} />
              ) : (
                <Circle size={20} color={theme.text.toggleThumbInactive} />
              )}
              <Text
                color={
                  status === "pending"
                    ? theme.text.toggleThumbInactive
                    : status === "active"
                      ? theme.text.primary
                      : clipperTheme.accentLight
                }
                fontWeight={status === "active" ? "semibold" : "medium"}
              >
                {step.label}
              </Text>
            </HStack>
          );
        })}
      </VStack>

      {state.stage === "uploading" && state.stageProgress != null && (
        <ClipperProgressBar
          label={
            state.stageMessage.toLowerCase().includes("trim")
              ? "Trimming clip"
              : "Saving to project"
          }
          value={state.stageProgress}
        />
      )}

      {state.stage === "transcribing" && state.stageProgress != null && (
        <ClipperProgressBar label="Transcribing speech" value={state.stageProgress} />
      )}

      {(state.stage === "analyzing-faces" || state.stage === "analyzing-subjects") && (
        <ClipperProgressBar
          label="Detecting faces & tracking action"
          value={combinedAnalysisProgress(state)}
          caption={state.stage === "analyzing-faces" ? formatEta(state.analysisEtaSeconds) : undefined}
        />
      )}
    </VStack>
  );
};
