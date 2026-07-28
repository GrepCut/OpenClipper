import type { Project } from "../../../../services/projects.service";
import type { ClipperProjectMetadata } from "../../persistence/project-metadata.util";
import type { ClipperClipPayload } from "../../persistence/clipper-clips-api.util";
import type { PipelineReporter } from "../../pipeline/reporter.util";
import type { ClipperSession } from "../../pipeline/session.util";
import type { ClipperSettings } from "../../settings/settings.util";
import type { ClipperPipelineState, ClipSourceMode } from "../../shared/state.util";
import type { ClipperStage } from "../../shared/stages.util";
import type { ClipperLoadedProject } from "../use-clipper-project-loader.hook";
import { EMPTY_CLIPPER_PIPELINE_STATE } from "../../pipeline/resume.util";

export const METADATA_IMMEDIATE_FLUSH_STAGES: ClipperStage[] = ["preview", "done", "error"];

export const INITIAL_PIPELINE_STATE = EMPTY_CLIPPER_PIPELINE_STATE;

export interface UseClipperPipelineOptions {
  project: Project;
  token: string | null;
  loaded: ClipperLoadedProject | null;
}

export interface ClipperPipelineRefs {
  abortRef: React.MutableRefObject<AbortController | null>;
  previewUrlsRef: React.MutableRefObject<string[]>;
  sessionRef: React.MutableRefObject<ClipperSession | null>;
  activeClipIndexRef: React.MutableRefObject<number>;
  metadataRef: React.MutableRefObject<ClipperProjectMetadata>;
  resumeStartedRef: React.MutableRefObject<boolean>;
  loadedResumeKeyRef: React.MutableRefObject<string | null>;
  aiClipsMetaRef: React.MutableRefObject<ClipperClipPayload[]>;
  reporterRef: React.MutableRefObject<PipelineReporter>;
  aiChatAbortRef: React.MutableRefObject<AbortController | null>;
}

export interface ClipperPipelineCoreDeps {
  project: Project;
  loaded: ClipperLoadedProject | null;
  state: ClipperPipelineState;
  setState: React.Dispatch<React.SetStateAction<ClipperPipelineState>>;
  settings: ClipperSettings;
  setSettingsState: React.Dispatch<React.SetStateAction<ClipperSettings>>;
  refs: ClipperPipelineRefs;
  setPersistedExportCount: React.Dispatch<React.SetStateAction<number>>;
  setRangeLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setDisabledCollageRegionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setAutoPartsSegmentLengthSec: React.Dispatch<
    React.SetStateAction<import("../../engine/segmentation").AutoPartsSegmentLengthSec>
  >;
}
