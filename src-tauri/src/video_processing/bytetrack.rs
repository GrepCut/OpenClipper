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
}

#[derive(Clone, Debug)]
pub struct TrackOutput {
    pub box_: NormalizedBox,
    pub label: String,
    pub score: f32,
    pub track_id: u64,
    pub predicted: bool,
    pub source_index: Option<usize>,
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
    mean: [f32; 8], // [cx, cy, aspect, height, vx, vy, va, vh]
    covariance: [[f32; 8]; 8],
    state: TrackState,
    hits: u32,
    last_time: f64,
    lost_since: Option<f64>,
    observed: bool,
    source_index: Option<usize>,
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
            mean,
            covariance,
            state: TrackState::Tentative,
            hits: 1,
            last_time: time,
            lost_since: None,
            observed: true,
            source_index: Some(detection.source_index),
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
        self.score = detection.score;
        self.hits += 1;
        if self.hits >= 2 {
            self.state = TrackState::Tracked;
        }
        self.last_time = time;
        self.lost_since = None;
        self.observed = true;
        self.source_index = Some(detection.source_index);
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
}

impl ByteTracker {
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            next_id: 1,
        }
    }

    pub fn reset(&mut self) {
        self.tracks.clear();
    }

    pub fn update(&mut self, time: f64, detections: &[TrackDetection]) -> Vec<TrackOutput> {
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

        self.tracks
            .iter()
            .filter_map(|track| match track.state {
                TrackState::Tracked => Some(TrackOutput {
                    box_: track.box_(),
                    label: track.label.clone(),
                    score: track.score,
                    track_id: track.id,
                    predicted: !track.observed,
                    source_index: track.source_index,
                }),
                TrackState::Lost
                    if track
                        .lost_since
                        .map_or(false, |lost| time - lost <= PREDICTION_HOLD_SECONDS) =>
                {
                    Some(TrackOutput {
                        box_: track.box_(),
                        label: track.label.clone(),
                        score: track.score * 0.5,
                        track_id: track.id,
                        predicted: true,
                        source_index: None,
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

/// Minimum-cost perfect assignment for a square matrix (Kuhn-Munkres).
fn hungarian(cost: &[Vec<f32>]) -> Vec<(usize, usize)> {
    let size = cost.len();
    let mut u = vec![0.0f32; size + 1];
    let mut v = vec![0.0f32; size + 1];
    let mut p = vec![0usize; size + 1];
    let mut way = vec![0usize; size + 1];
    for row in 1..=size {
        p[0] = row;
        let mut column0 = 0usize;
        let mut min_value = vec![f32::INFINITY; size + 1];
        let mut used = vec![false; size + 1];
        loop {
            used[column0] = true;
            let row0 = p[column0];
            let mut delta = f32::INFINITY;
            let mut column1 = 0usize;
            for column in 1..=size {
                if used[column] {
                    continue;
                }
                let current = cost[row0 - 1][column - 1] - u[row0] - v[column];
                if current < min_value[column] {
                    min_value[column] = current;
                    way[column] = column0;
                }
                if min_value[column] < delta {
                    delta = min_value[column];
                    column1 = column;
                }
            }
            for column in 0..=size {
                if used[column] {
                    u[p[column]] += delta;
                    v[column] -= delta;
                } else {
                    min_value[column] -= delta;
                }
            }
            column0 = column1;
            if p[column0] == 0 {
                break;
            }
        }
        loop {
            let column1 = way[column0];
            p[column0] = p[column1];
            column0 = column1;
            if column0 == 0 {
                break;
            }
        }
    }
    (1..=size)
        .filter_map(|column| {
            if p[column] > 0 {
                Some((p[column] - 1, column - 1))
            } else {
                None
            }
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn detection(x: f32, label: &str, score: f32, source_index: usize) -> TrackDetection {
        TrackDetection {
            box_: NormalizedBox {
                x,
                y: 0.2,
                width: 0.2,
                height: 0.4,
            },
            label: label.into(),
            score,
            source_index,
        }
    }

    #[test]
    fn confirms_and_recovers_a_low_score_detection() {
        let mut tracker = ByteTracker::new();
        assert!(tracker
            .update(0.0, &[detection(0.1, "person", 0.9, 0)])
            .is_empty());
        let active = tracker.update(0.2, &[detection(0.11, "person", 0.9, 0)]);
        assert_eq!(active.len(), 1);
        let id = active[0].track_id;
        let recovered = tracker.update(0.4, &[detection(0.12, "person", 0.3, 0)]);
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].track_id, id);
    }

    #[test]
    fn never_matches_across_classes_or_scene_cuts() {
        let mut tracker = ByteTracker::new();
        tracker.update(0.0, &[detection(0.1, "person", 0.9, 0)]);
        let person = tracker.update(0.2, &[detection(0.1, "person", 0.9, 0)]);
        tracker.update(0.4, &[detection(0.1, "car", 0.9, 0)]);
        assert!(tracker
            .update(0.6, &[detection(0.1, "car", 0.9, 0)])
            .iter()
            .all(|item| item.label == "car"));
        tracker.reset();
        tracker.update(0.8, &[detection(0.1, "person", 0.9, 0)]);
        let after_cut = tracker.update(1.0, &[detection(0.1, "person", 0.9, 0)]);
        assert_ne!(person[0].track_id, after_cut[0].track_id);
    }

    #[test]
    fn holds_prediction_briefly_then_expires() {
        let mut tracker = ByteTracker::new();
        tracker.update(0.0, &[detection(0.1, "person", 0.9, 0)]);
        tracker.update(0.2, &[detection(0.1, "person", 0.9, 0)]);
        assert!(tracker.update(0.4, &[]).iter().any(|item| item.predicted));
        assert!(tracker.update(1.1, &[]).is_empty());
    }

    #[test]
    fn associate_ignores_dummy_hungarian_assignments() {
        let mut tracker = ByteTracker::new();
        tracker.update(0.0, &[detection(0.1, "person", 0.9, 0)]);
        tracker.update(0.2, &[detection(0.11, "person", 0.9, 0)]);
        let active = tracker.update(
            0.4,
            &[
                detection(0.11, "person", 0.9, 0),
                detection(0.5, "person", 0.9, 1),
            ],
        );
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].track_id, 1);
    }
}
