export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubjectDetection {
  box: NormalizedBox;
  label: string;
  score: number;
  /** Native ByteTrack identity. */
  trackId?: number;
  /** A short-lived Kalman prediction emitted while the target is occluded. */
  predicted?: boolean;
  /** Detector that last observed this ByteTrack trajectory. */
  detectorSource?: "yolox" | "pose";
  /** Scene-local identity shared by person, face and pose evidence. */
  canonicalId?: number;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  /** Project-wide identity assigned after the complete analysis range is observed. */
  projectIdentityId?: string;
}

/** Full-range face detector output used only for AutoFlip's landmark signals. */
export interface AutoFlipFaceDetection {
  box: NormalizedBox;
  keypoints: Array<{ x: number; y: number }>;
  /** Stable native face identity, used to attach active-speaker evidence. */
  trackId?: number;
  predicted?: boolean;
  canonicalId?: number;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  projectIdentityId?: string;
}

/** Compact pose output retained by the cropper; raw model keypoints stay transient. */
export interface PoseSubject {
  box: NormalizedBox;
  score: number;
  trackId?: number;
  predicted?: boolean;
  headBox?: NormalizedBox;
  torsoBox?: NormalizedBox;
  canonicalId?: number;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  projectIdentityId?: string;
}

export interface SubjectDetectionSample {
  time: number;
  detections: SubjectDetection[];
  /** LR-ASD probabilities keyed to existing native face tracks. */
  activeSpeakerScores?: Array<{ trackId: number; confidence: number }>;
  autoflipFaces?: AutoFlipFaceDetection[];
  poseSubjects?: PoseSubject[];
  /** Sparse semantic/action proposals aligned to this detector sample. */
  importanceSignals?: ImportanceSignalRegion[];
  /** Detector that produced this sample; persisted only as analysis provenance. */
  modelId?: string;
  /** Scene boundary marker; pending recovery/ASD state must not cross it. */
  sceneCut?: boolean;
  /** Global camera motion residual from ByteTrack GMC (normalized displacement). */
  cameraMotionResidual?: number;
  /** OSNet appearance embedding when multiple people are present (multi-person scenes). */
  reidEmbedding?: number[];
  /** Present when the exact AutoFlip model could not be initialized. */
  degradedReason?: string;
  /** Scene-local fused identities. Predicted-only snapshots are diagnostic and cannot create layout targets. */
  canonicalPersons?: CanonicalPersonTrack[];
  activeSpeakerDisabledReason?: string;
}

export interface ActiveSpeakerTelemetry {
  enabled: boolean;
  disabledReason?: string;
  evaluatedWindows: number;
  speakerSwitches: number;
  ambiguousWindows: number;
  asdDutyCycle: number;
  runtimeMs?: number;
}

export type CanonicalTrackState = "observed" | "predicted";

export interface CanonicalPersonTrack {
  canonicalId: number;
  personBox?: NormalizedBox;
  faceBox?: NormalizedBox;
  poseBox?: NormalizedBox;
  sources: Array<"person" | "face" | "pose">;
  confidence: number;
  associationConfidence: number;
  velocity: { x: number; y: number };
  lastObservedTime: number;
  state: CanonicalTrackState;
  identityAmbiguous: boolean;
}

export interface CanonicalIdentityTelemetry {
  births: number;
  deaths: number;
  switches: number;
  ambiguousSamples: number;
  sampleCount: number;
  dropoutDurationsSec: number[];
  successfulReacquisitions: number;
  associationConfidences: number[];
}

export interface MotionRegion extends NormalizedBox {
  energy: number;
  expansion: number;
}

export interface MotionSample {
  time: number;
  regions: MotionRegion[];
}

/** Optional semantic signals produced by specialised local analyzers. */
export type ImportanceSignalKind =
  | "video-saliency"
  | "active-speaker"
  | "head"
  | "screen"
  | "motion";

export interface ImportanceSignalRegion {
  box: NormalizedBox;
  kind: ImportanceSignalKind;
  confidence: number;
  trackId?: number;
  predicted?: boolean;
}

export interface ImportanceSignalSample {
  time: number;
  regions: ImportanceSignalRegion[];
}

export type ImportanceRegionKind =
  | "face"
  | "head"
  | "speaker"
  | "person"
  | "action"
  | "screen"
  | "object";

export type ImportanceRegionSource =
  | "face"
  | "head"
  | "pose"
  | "person"
  | "object"
  | "motion"
  | "video-saliency"
  | "active-speaker";

/** How safely a region may take control of automatic framing. */
export type ImportanceRegionTrust =
  | "verified-person"
  | "unverified-person"
  /** A detector-only person that passed the local continuity gate. */
  | "temporally-qualified-person"
  | "video-saliency"
  | "object";

export type CompositionEntityKind = "person" | "object";

/** Compact, non-biometric project-wide evidence used to bias reframing. */
export interface CompositionMemoryEntity {
  id: string;
  kind: CompositionEntityKind;
  label?: string;
  importanceScore: number;
  observedSeconds: number;
  speakerSeconds: number;
  sceneCount: number;
  medianHeight: number;
  continuity: number;
  saliency: number;
}

/** Persisted result of global composition analysis. Raw frames and embeddings never leave runtime memory. */
export interface CompositionMemorySummary {
  version: 2;
  entities: CompositionMemoryEntity[];
  /** Descending project-wide priority table across people and objects. */
  rankedEntityIds: string[];
  maxEntitiesPerKind: number;
  degradedReason?: string;
}

/** A temporally ranked editing target, distinct from a raw detector box. */
export interface ImportanceRegion {
  id: string;
  box: NormalizedBox;
  /** Broader region that should remain visible while `box` drives composition. */
  contentBox: NormalizedBox;
  kind: ImportanceRegionKind;
  importanceScore: number;
  confidence: number;
  /** Native detector confidence retained for temporal-only person qualification. */
  detectorConfidence?: number;
  required: boolean;
  role: "primary" | "secondary" | "candidate";
  sources: ImportanceRegionSource[];
  /** The evidence class that allowed this region to influence framing. */
  trust?: ImportanceRegionTrust;
  trackId?: number;
  predicted?: boolean;
  associationConfidence?: number;
  identityAmbiguous?: boolean;
  projectIdentityId?: string;
  /** Global project evidence blended into this frame-local target. */
  compositionScore?: number;
}

export type TargetEvidenceStatus = "qualified" | "temporal-pending" | "no-candidate";

/** Compact explanation of why a frame can or cannot receive a framing score. */
export interface TargetEvidence {
  status: TargetEvidenceStatus;
  verifiedPersonCount: number;
  unverifiedPersonCount: number;
  temporallyQualifiedPersonCount: number;
}

export interface ImportanceRegionSample {
  time: number;
  regions: ImportanceRegion[];
  cut?: boolean;
  targetEvidence?: TargetEvidence;
}

/** A split has two or three viewports; its arity defines the rendered template. */
export type ClipperLayoutMode = "single-crop" | "split" | "contain";
export type ClipperLayoutStrategy =
  | "legacy-baseline"
  | "semantic-single"
  | "semantic-split"
  | "semantic-split-3"
  | "detector-splice";

/** Source-space render instruction for one instant of one output format. */
export interface ClipperLayoutSample {
  t: number;
  mode: ClipperLayoutMode;
  /** Legacy-baseline samples carry the Run4 camera-path window as their viewports. */
  strategy?: ClipperLayoutStrategy;
  viewports: NormalizedBox[];
  /** Shadow proposal retained even when the baseline wins arbitration. */
  candidateMode?: ClipperLayoutMode;
  candidateViewports?: NormalizedBox[];
  /** Run4 camera-path crop, retained even when the semantic proposal wins. */
  baselineViewports?: NormalizedBox[];
  primaryRegionId?: string;
  requiredRegionIds: string[];
  /** The detected subject assigned to each rendered panel.  This makes panel
   * identity explicit, so temporal filtering cannot blend one speaker's crop
   * into another speaker's panel. */
  panelSubjects?: Array<{ id: string; focusBox: NormalizedBox }>;
  baselineScore?: number;
  semanticScore?: number;
  decisionConfidence?: number;
  reasonCodes?: string[];
  /** Evidence summary used by the framing diagnostics and fault-frame export. */
  targetEvidence?: TargetEvidence;
  /** Run 9 counterfactual rescue ladder, persisted for offline replay/audit. */
  candidateVariants?: Array<{
    kind: "run8-baseline" | "shifted-crop" | "wider-crop" | "stable-split-v2" | "stable-split-v3" | "stable-split-3";
    mode: ClipperLayoutMode;
    viewports: NormalizedBox[];
    requiredCoverage: number[];
    panelSubjects?: Array<{ id: string; focusBox: NormalizedBox }>;
  }>;
  /** Per-required-envelope hard coverage before and after arbitration. */
  baselineRequiredCoverage?: number[];
  selectedRequiredCoverage?: number[];
  visibilityRisk?: boolean;
  /** Quality telemetry that does not use benchmark ground truth. */
  qualityTelemetry?: {
    containDutyCandidate: boolean;
    subjectDisplayHeightFractions: number[];
  };
  /** Required boxes used to validate intermediate interpolation frames. */
  coverageBoxes?: NormalizedBox[];
  cut?: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export interface ClipperLayoutTrack {
  targetAspectRatio: number;
  samples: ClipperLayoutSample[];
}

/** Static-background observation captured alongside an AutoFlip keyframe. */
export interface AutoFlipStaticFeatureSample {
  time: number;
  hasSolidColorBackground: boolean;
  solidBackgroundColor?: { r: number; g: number; b: number };
}

/**
 * A render instruction emitted by AutoFlip for one output aspect ratio.
 * `crop` is expressed in normalized source coordinates.
 */
export interface AutoFlipCropSample {
  t: number;
  crop: NormalizedBox;
  cut?: boolean;
  /** AutoFlip could not cover all salient regions at this keyframe. */
  hasUncoveredSalient?: boolean;
  /** Per-scene padding colour. Never apply a background decision to another shot. */
  solidBackgroundColor?: { r: number; g: number; b: number };
}

export interface AutoFlipAspectTrack {
  /** Width / height of the output frame. */
  targetAspectRatio: number;
  samples: AutoFlipCropSample[];
}

/** Diagnostic snapshot of one analyzed scene for one output aspect. */
export interface AutoFlipSceneDebug {
  formatId: string;
  start: number;
  end: number;
  motionType: string;
  lookAtCenterX: number;
  lookAtCenterY: number;
  cropWindowWidthNorm: number;
  cropWindowHeightNorm: number;
  successRate?: number;
  keyframes: Array<{
    time: number;
    regions: Array<{ box: NormalizedBox; score: number; signalType: string }>;
    chosenRect?: NormalizedBox;
  }>;
}

export interface ClipperSmartCropBlob {
  analyzerVersion: string;
  modelId: string;
  /** Runtime provenance. */
  engine?: "winml";
  /** Present when the native analysis used temporal ByteTrack stabilization. */
  trackerVersion?: "bytetrack-v1" | "bytetrack-v2";
  clipStart: number;
  clipEnd: number;
  /** Reframe profile used to build this camera path; mismatches require rebuild. */
  cameraSmoothing?: "smooth" | "balanced" | "snappy";
  /** Target crop aspect ratio (width / height) used when building the track. */
  targetAspectRatio?: number;
  /** Source-space active image area after static letterbox borders are removed. */
  contentRect?: NormalizedBox;
  /** Stable background colour used by AutoFlip's padding path when available. */
  solidBackgroundColor?: { r: number; g: number; b: number };
  degradedReason?: string;
  /** Independent, lossless AutoFlip paths for every enabled crop format. */
  aspectTracks?: Record<string, AutoFlipAspectTrack>;
  /** v3: human-importance targets retained for diagnostics and future reranking. */
  importanceSamples?: ImportanceRegionSample[];
  /** v3: format-aware crop/split/contain decisions used before legacy collage logic. */
  layoutTracks?: Record<string, ClipperLayoutTrack>;
  canonicalIdentityTelemetry?: CanonicalIdentityTelemetry;
  activeSpeakerTelemetry?: ActiveSpeakerTelemetry;
  /** v4: global person/object evidence computed before any crop paths are planned. */
  compositionMemory?: CompositionMemorySummary;
  /** Present only when the caller asked for diagnostics; never persisted by production analysis. */
  debug?: AutoFlipSceneDebug[];
}
