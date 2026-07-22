//! Minimal, dependency-free ByteTrack implementation for the sparse (5 FPS)
//! AutoFlip feature stream. Adapted from the MIT-licensed ByteTrack tracker:
//! https://github.com/ifzhang/ByteTrack

use super::vision_logic::{box_iou, NormalizedBox};

const HIGH_SCORE: f32 = 0.6;
const LOW_SCORE: f32 = 0.1;
const NEW_TRACK_SCORE: f32 = 0.7;
const HIGH_MATCH_COST: f32 = 0.8; // IoU >= 0.2, matching ByteTrack defaults.
const LOW_MATCH_COST: f32 = 0.5; // Keep low-confidence recovery conservative.
const MAX_LOST_SECONDS: f64 = 1.0;
const PREDICTION_HOLD_SECONDS: f64 = 0.6;

#[derive(Clone, Debug)]
pub struct TrackDetection {
    pub box_: NormalizedBox,
    pub label: String,
    pub score: f32,
    /// Index in the source result set; lets callers retain face landmarks.
    pub source_index: usize,
    pub detector_source: Option<&'static str>,
}

#[derive(Clone, Debug)]
pub struct TrackOutput {
    pub box_: NormalizedBox,
    pub label: String,
    pub score: f32,
    pub track_id: u64,
    pub predicted: bool,
    pub source_index: Option<usize>,
    pub detector_source: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrackState {
    Tentative,
    Tracked,
    Lost,
    Removed,
}

#[derive(Clone, Debug)]
struct Track {
    id: u64,
    label: String,
    score: f32,
    score_ema: f32,
    mean: [f32; 8], // [cx, cy, aspect, height, vx, vy, va, vh]
    covariance: [[f32; 8]; 8],
    state: TrackState,
    hits: u32,
    last_time: f64,
    lost_since: Option<f64>,
    observed: bool,
    source_index: Option<usize>,
    detector_source: Option<&'static str>,
}

impl Track {
    fn from_detection(id: u64, time: f64, detection: &TrackDetection) -> Self {
        let height = detection.box_.height.max(1e-4);
        let mean = [
            detection.box_.x + detection.box_.width / 2.0,
            detection.box_.y + detection.box_.height / 2.0,
            detection.box_.width / height,
            height,
            0.0,
            0.0,
            0.0,
            0.0,
        ];
        // ByteTrack's initiate covariance, expressed in normalized image space.
        let position = height / 20.0;
        let velocity = height / 160.0;
        let std = [
            2.0 * position,
            2.0 * position,
            1e-2,
            2.0 * position,
            10.0 * velocity,
            10.0 * velocity,
            1e-5,
            10.0 * velocity,
        ];
        let mut covariance = [[0.0; 8]; 8];
        for index in 0..8 {
            covariance[index][index] = std[index] * std[index];
        }
        Self {
            id,
            label: detection.label.clone(),
            score: detection.score,
            score_ema: detection.score,
            mean,
            covariance,
            state: TrackState::Tentative,
            hits: 1,
            last_time: time,
            lost_since: None,
            observed: true,
            source_index: Some(detection.source_index),
            detector_source: detection.detector_source,
        }
    }

    fn predict(&mut self, time: f64) {
        let dt = ((time - self.last_time) / 0.2).clamp(0.5, 3.0) as f32;
        for index in 0..4 {
            self.mean[index] += self.mean[index + 4] * dt;
        }
        let mut motion = identity8();
        for index in 0..4 {
            motion[index][index + 4] = dt;
        }
        let height = self.mean[3].max(1e-4);
        let position = height / 20.0;
        let velocity = height / 160.0;
        let std = [
            position, position, 1e-2, position, velocity, velocity, 1e-5, velocity,
        ];
        let mut process = [[0.0; 8]; 8];
        for index in 0..8 {
            process[index][index] = std[index] * std[index];
        }
        self.covariance = add8(
            multiply8(multiply8(motion, self.covariance), transpose8(motion)),
            process,
        );
        self.last_time = time;
        self.observed = false;
        self.source_index = None;
    }

    fn update(&mut self, time: f64, detection: &TrackDetection) {
        let reacquired = self.lost_since.is_some();
        let height = detection.box_.height.max(1e-4);
        let measurement = [
            detection.box_.x + detection.box_.width / 2.0,
            detection.box_.y + detection.box_.height / 2.0,
            detection.box_.width / height,
            height,
        ];
        let mut innovation_covariance = [[0.0; 4]; 4];
        for row in 0..4 {
            for column in 0..4 {
                innovation_covariance[row][column] = self.covariance[row][column];
            }
        }
        let position = self.mean[3].max(1e-4) / 20.0;
        let measurement_std = [position, position, 1e-1, position];
        for index in 0..4 {
            innovation_covariance[index][index] += measurement_std[index] * measurement_std[index];
        }
        let Some(inverse) = invert4(innovation_covariance) else {
            return;
        };
        let mut gain = [[0.0; 4]; 8];
        for row in 0..8 {
            for column in 0..4 {
                for inner in 0..4 {
                    gain[row][column] += self.covariance[row][inner] * inverse[inner][column];
                }
            }
        }
        let mut innovation = [0.0; 4];
        for index in 0..4 {
            innovation[index] = measurement[index] - self.mean[index];
        }
        for row in 0..8 {
            for column in 0..4 {
                self.mean[row] += gain[row][column] * innovation[column];
            }
        }
        let mut correction = [[0.0; 8]; 8];
        for row in 0..8 {
            for column in 0..8 {
                for inner in 0..4 {
                    correction[row][column] += gain[row][inner] * self.covariance[inner][column];
                }
            }
        }
        self.covariance = subtract8(self.covariance, correction);
        if reacquired {
            // ponytail: observation-centric snap after reacquire; upgrade path = full OC-SORT
            for index in 0..4 {
                self.mean[index] = self.mean[index] * 0.35 + measurement[index] * 0.65;
            }
        }
        self.score = detection.score;
        self.score_ema = self.score_ema * 0.8 + detection.score * 0.2;
        self.hits += 1;
        if self.hits >= 2 {
            self.state = TrackState::Tracked;
        }
        self.last_time = time;
        self.lost_since = None;
        self.observed = true;
        self.source_index = Some(detection.source_index);
        self.detector_source = detection.detector_source;
    }

    fn box_(&self) -> NormalizedBox {
        let height = self.mean[3].max(1e-4);
        let width = (self.mean[2] * height).max(1e-4);
        let left = (self.mean[0] - width / 2.0).clamp(0.0, 1.0);
        let top = (self.mean[1] - height / 2.0).clamp(0.0, 1.0);
        let right = (self.mean[0] + width / 2.0).clamp(0.0, 1.0);
        let bottom = (self.mean[1] + height / 2.0).clamp(0.0, 1.0);
        NormalizedBox {
            x: left,
            y: top,
            width: (right - left).max(0.0),
            height: (bottom - top).max(0.0),
        }
    }
}

/// ByteTrack association for a sparse AutoFlip stream. Tracks are deliberately
/// class-aware: COCO classes must never inherit each other's identity.
pub struct ByteTracker {
    tracks: Vec<Track>,
    next_id: u64,
    last_global_center: Option<(f32, f32)>,
    last_camera_motion: f32,
}

impl ByteTracker {
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            next_id: 1,
            last_global_center: None,
            last_camera_motion: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.tracks.clear();
        self.last_global_center = None;
        self.last_camera_motion = 0.0;
    }

    pub fn last_camera_motion(&self) -> f32 {
        self.last_camera_motion
    }

    fn estimate_global_center(detections: &[TrackDetection]) -> Option<(f32, f32)> {
        let high: Vec<_> = detections
            .iter()
            .filter(|detection| detection.score >= HIGH_SCORE)
            .collect();
        if high.is_empty() {
            return None;
        }
        let count = high.len() as f32;
        let cx = high
            .iter()
            .map(|detection| detection.box_.x + detection.box_.width / 2.0)
            .sum::<f32>()
            / count;
        let cy = high
            .iter()
            .map(|detection| detection.box_.y + detection.box_.height / 2.0)
            .sum::<f32>()
            / count;
        Some((cx, cy))
    }

    fn compensate_detections(
        detections: &[TrackDetection],
        dx: f32,
        dy: f32,
    ) -> Vec<TrackDetection> {
        detections
            .iter()
            .map(|detection| {
                let mut compensated = detection.clone();
                compensated.box_.x = (compensated.box_.x - dx).clamp(0.0, 1.0);
                compensated.box_.y = (compensated.box_.y - dy).clamp(0.0, 1.0);
                compensated
            })
            .collect()
    }

    pub fn update(&mut self, time: f64, detections: &[TrackDetection]) -> Vec<TrackOutput> {
        let (working, motion) = if let Some(center) = Self::estimate_global_center(detections) {
            let (dx, dy) = match self.last_global_center {
                Some((previous_x, previous_y)) => (center.0 - previous_x, center.1 - previous_y),
                None => (0.0, 0.0),
            };
            self.last_global_center = Some(center);
            self.last_camera_motion = (dx * dx + dy * dy).sqrt();
            (Self::compensate_detections(detections, dx, dy), self.last_camera_motion)
        } else {
            (detections.to_vec(), 0.0)
        };
        self.last_camera_motion = motion;
        self.update_associated(time, &working)
    }

    fn update_associated(&mut self, time: f64, detections: &[TrackDetection]) -> Vec<TrackOutput> {
        for track in &mut self.tracks {
            track.predict(time);
        }
        let high: Vec<usize> = detections
            .iter()
            .enumerate()
            .filter_map(|(index, value)| (value.score >= HIGH_SCORE).then_some(index))
            .collect();
        let low: Vec<usize> = detections
            .iter()
            .enumerate()
            .filter_map(|(index, value)| {
                (value.score >= LOW_SCORE && value.score < HIGH_SCORE).then_some(index)
            })
            .collect();
        let pool: Vec<usize> = self
            .tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| (track.state != TrackState::Removed).then_some(index))
            .collect();
        let first_matches = associate(&self.tracks, &pool, detections, &high, HIGH_MATCH_COST);
        let mut matched_tracks = vec![false; self.tracks.len()];
        let mut matched_detections = vec![false; detections.len()];
        for (track_index, detection_index) in first_matches {
            self.tracks[track_index].update(time, &detections[detection_index]);
            matched_tracks[track_index] = true;
            matched_detections[detection_index] = true;
        }

        let remaining_tracked: Vec<usize> = self
            .tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| {
                (!matched_tracks[index] && track.state == TrackState::Tracked).then_some(index)
            })
            .collect();
        for (track_index, detection_index) in associate(
            &self.tracks,
            &remaining_tracked,
            detections,
            &low,
            LOW_MATCH_COST,
        ) {
            self.tracks[track_index].update(time, &detections[detection_index]);
            matched_tracks[track_index] = true;
            matched_detections[detection_index] = true;
        }

        for (index, track) in self.tracks.iter_mut().enumerate() {
            if matched_tracks[index] {
                continue;
            }
            match track.state {
                TrackState::Tracked => {
                    track.state = TrackState::Lost;
                    track.lost_since = Some(time);
                }
                TrackState::Tentative => track.state = TrackState::Removed,
                TrackState::Lost | TrackState::Removed => {}
            }
        }
        for detection_index in high {
            if matched_detections[detection_index]
                || detections[detection_index].score < NEW_TRACK_SCORE
            {
                continue;
            }
            self.tracks.push(Track::from_detection(
                self.next_id,
                time,
                &detections[detection_index],
            ));
            self.next_id += 1;
        }
        self.tracks.retain(|track| {
            track.state != TrackState::Removed
                && track
                    .lost_since
                    .map_or(true, |lost| time - lost <= MAX_LOST_SECONDS)
        });

        // Once a new observed track is confirmed over the same location, do
        // not also emit a short-lived prediction from an incompatible class.
        // The tracks remain separate (and therefore never match across
        // classes), but downstream framing must not see a duplicate ghost.
        let observed_boxes: Vec<NormalizedBox> = self
            .tracks
            .iter()
            .filter(|track| track.state == TrackState::Tracked && track.observed)
            .map(Track::box_)
            .collect();

        self.tracks
            .iter()
            .filter_map(|track| match track.state {
                TrackState::Tracked => Some(TrackOutput {
                    box_: track.box_(),
                    label: track.label.clone(),
                    score: track.score_ema,
                    track_id: track.id,
                    predicted: !track.observed,
                    source_index: track.source_index,
                    detector_source: track.detector_source,
                }),
                TrackState::Lost
                    if track
                        .lost_since
                        .map_or(false, |lost| time - lost <= PREDICTION_HOLD_SECONDS)
                        && !observed_boxes
                            .iter()
                            .any(|observed| box_iou(track.box_(), *observed) >= 0.5) =>
                {
                    Some(TrackOutput {
                        box_: track.box_(),
                        label: track.label.clone(),
                        score: track.score * 0.5,
                        track_id: track.id,
                        predicted: true,
                        source_index: None,
                        detector_source: track.detector_source,
                    })
                }
                _ => None,
            })
            .collect()
    }
}

fn associate(
    tracks: &[Track],
    track_indices: &[usize],
    detections: &[TrackDetection],
    detection_indices: &[usize],
    threshold: f32,
) -> Vec<(usize, usize)> {
    if track_indices.is_empty() || detection_indices.is_empty() {
        return Vec::new();
    }
    let count = track_indices.len() + detection_indices.len();
    let unmatched = threshold + 0.01;
    let mut costs = vec![vec![unmatched; count]; count];
    for (row, &track_index) in track_indices.iter().enumerate() {
        for (column, &detection_index) in detection_indices.iter().enumerate() {
            let track = &tracks[track_index];
            let detection = &detections[detection_index];
            let cost = 1.0 - box_iou(track.box_(), detection.box_);
            if track.label == detection.label && cost <= threshold {
                costs[row][column] = cost;
            } else {
                costs[row][column] = 1_000.0;
            }
        }
    }
    hungarian(&costs)
        .into_iter()
        .filter_map(|(row, column)| {
            if row < track_indices.len()
                && column < detection_indices.len()
                && costs[row][column] <= threshold
            {
                Some((track_indices[row], detection_indices[column]))
            } else {
                None
            }
        })
        .collect()
}

/// Minimum-cost perfect assignment for a square matrix (lapjv).
fn hungarian(cost: &[Vec<f32>]) -> Vec<(usize, usize)> {
    use lapjv::{lapjv, Matrix};

    let size = cost.len();
    if size == 0 {
        return Vec::new();
    }
    let flat: Vec<f32> = cost.iter().flat_map(|row| row.iter().copied()).collect();
    let Ok(matrix) = Matrix::from_shape_vec((size, size), flat) else {
        return Vec::new();
    };
    let Ok((row_solution, _)) = lapjv(&matrix) else {
        return Vec::new();
    };
    row_solution
        .into_iter()
        .enumerate()
        .map(|(row, col)| (row, col))
        .collect()
}

fn identity8() -> [[f32; 8]; 8] {
    let mut value = [[0.0; 8]; 8];
    for index in 0..8 {
        value[index][index] = 1.0;
    }
    value
}
fn transpose8(value: [[f32; 8]; 8]) -> [[f32; 8]; 8] {
    let mut output = [[0.0; 8]; 8];
    for row in 0..8 {
        for column in 0..8 {
            output[row][column] = value[column][row];
        }
    }
    output
}
fn multiply8(left: [[f32; 8]; 8], right: [[f32; 8]; 8]) -> [[f32; 8]; 8] {
    let mut output = [[0.0; 8]; 8];
    for row in 0..8 {
        for column in 0..8 {
            for inner in 0..8 {
                output[row][column] += left[row][inner] * right[inner][column];
            }
        }
    }
    output
}
fn add8(left: [[f32; 8]; 8], right: [[f32; 8]; 8]) -> [[f32; 8]; 8] {
    let mut output = [[0.0; 8]; 8];
    for row in 0..8 {
        for column in 0..8 {
            output[row][column] = left[row][column] + right[row][column];
        }
    }
    output
}
fn subtract8(left: [[f32; 8]; 8], right: [[f32; 8]; 8]) -> [[f32; 8]; 8] {
    let mut output = [[0.0; 8]; 8];
    for row in 0..8 {
        for column in 0..8 {
            output[row][column] = left[row][column] - right[row][column];
        }
    }
    output
}
fn invert4(value: [[f32; 4]; 4]) -> Option<[[f32; 4]; 4]> {
    let mut augmented = [[0.0; 8]; 4];
    for row in 0..4 {
        for column in 0..4 {
            augmented[row][column] = value[row][column];
        }
        augmented[row][row + 4] = 1.0;
    }
    for pivot in 0..4 {
        let mut best = pivot;
        for row in pivot + 1..4 {
            if augmented[row][pivot].abs() > augmented[best][pivot].abs() {
                best = row;
            }
        }
        if augmented[best][pivot].abs() < 1e-8 {
            return None;
        }
        augmented.swap(pivot, best);
        let divisor = augmented[pivot][pivot];
        for column in 0..8 {
            augmented[pivot][column] /= divisor;
        }
        for row in 0..4 {
            if row == pivot {
                continue;
            }
            let factor = augmented[row][pivot];
            for column in 0..8 {
                augmented[row][column] -= factor * augmented[pivot][column];
            }
        }
    }
    let mut inverse = [[0.0; 4]; 4];
    for row in 0..4 {
        for column in 0..4 {
            inverse[row][column] = augmented[row][column + 4];
        }
    }
    Some(inverse)
}
