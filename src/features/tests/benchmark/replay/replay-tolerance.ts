/**
 * JSON round-tripping normalized layout samples and re-interpolating them at
 * decoded-frame timestamps can move a viewport edge by ~1e-7. A target lying
 * exactly on the 0.85 boundary can therefore move one observation across the
 * hit threshold (the observed run-2 maximum is 0.1032 pp). Strategies must
 * still match exactly; metric drift is capped below the 0.2 pp promotion gate.
 */
export const REPLAY_METRIC_TOLERANCE = 0.0011;
