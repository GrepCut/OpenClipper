export const CLIPPER_SEGMENT_LENGTH_SEC = 60;
/** Soft lower bound when snapping clip ends to keyframes (~45s). */
export const CLIPPER_SEGMENT_MIN_SEC = 45;
/** Soft upper bound when snapping clip ends to keyframes (~90s). */
export const CLIPPER_SEGMENT_MAX_SEC = 90;

export const AUTO_PARTS_SEGMENT_LENGTH_OPTIONS = [15, 30, 45, 60] as const;

export const AUTO_PARTS_SEGMENT_LENGTH_MIN_SEC = 5;
export const AUTO_PARTS_SEGMENT_LENGTH_MAX_SEC = 180;
