mod media;
mod mfcc;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use anyhow::{ensure, Result};
use ort::value::TensorRef;
use serde::Serialize;

use super::super::vision::{open_ort_session, NativeVisionError};
use super::types::{NativeSubjectSample, NativeVisionProgress};
use media::{Reader, AUDIO_SAMPLES_PER_FRAME, FPS, SIDE};

const MIN_BLOCK_SPAN_SEC: f64 = 0.96 - 1e-6;
const MAX_SAMPLE_STEP_SEC: f64 = 0.36;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub track_id: u64,
    pub confidence: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleScores {
    pub index: usize,
    pub scores: Vec<Score>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub samples: Vec<SampleScores>,
    pub elapsed_ms: u64,
    pub decode_ms: u64,
    pub features_ms: u64,
    pub inference_ms: u64,
    pub analyzed_seconds: f64,
    pub windows: usize,
    pub skipped_blocks: usize,
    pub peak_working_set_mib: u64,
    pub disabled_reason: Option<String>,
}

/// Tracked, really observed faces that can open a speaker block. A face without a
/// tracker id cannot be scored over time, so it is ignored instead of discarding the
/// whole sample; duplicate ids are ambiguous and still disable the sample.
fn observed_ids(sample: &NativeSubjectSample) -> Vec<u64> {
    let mut ids: Vec<u64> = sample
        .autoflip_faces
        .iter()
        .filter(|f| f.predicted != Some(true))
        .filter_map(|f| f.track_id)
        .collect();
    ids.sort_unstable();
    if ids.len() < 2 || ids.windows(2).any(|w| w[0] == w[1]) {
        ids.clear();
    }
    ids
}

/// Light-ASD scores every face independently against the shared audio, so a block
/// only needs each of its participants to stay present (a short tracker prediction is
/// enough to crop it). A third face flickering in the background must not split the
/// conversation into sub-second pieces that are then dropped.
fn has_participants(sample: &NativeSubjectSample, ids: &[u64]) -> bool {
    ids.iter().all(|id| {
        sample
            .autoflip_faces
            .iter()
            .any(|f| f.track_id == Some(*id))
    })
}

/// Keep adjacent samples with the same participants together. Blocks share
/// only the endpoint used for interpolation and bound temporary crop storage.
/// If the tail of a continuous multi-face span is shorter than one second, extend
/// the final block backward inside the same span so trailing samples stay scored.
fn blocks(samples: &[NativeSubjectSample]) -> Vec<(usize, usize, Vec<u64>)> {
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < samples.len() {
        let ids = observed_ids(&samples[i]);
        let mut j = i + 1;
        while j < samples.len()
            && !ids.is_empty()
            && samples[j].scene_cut != Some(true)
            && samples[j].time > samples[j - 1].time
            && samples[j].time - samples[j - 1].time <= MAX_SAMPLE_STEP_SEC
            && has_participants(&samples[j], &ids)
        {
            j += 1;
        }
        if !ids.is_empty() && samples[j - 1].time - samples[i].time >= MIN_BLOCK_SPAN_SEC {
            let mut first = i;
            let count = (48 / ids.len()).clamp(5, 24); // bound simultaneous face crops
            while first + 1 < j {
                let last = (first + count).min(j - 1);
                if samples[last].time - samples[first].time >= MIN_BLOCK_SPAN_SEC {
                    blocks.push((first, last, ids.clone()));
                    first = last;
                } else {
                    // Extend the tail window backward within the same shot/participant span.
                    let mut tail_start = first;
                    while tail_start > i
                        && samples[last].time - samples[tail_start].time < MIN_BLOCK_SPAN_SEC
                    {
                        tail_start -= 1;
                    }
                    if samples[last].time - samples[tail_start].time >= MIN_BLOCK_SPAN_SEC
                        && blocks
                            .last()
                            .is_none_or(|&(pf, pl, _)| pf != tail_start || pl != last)
                    {
                        blocks.push((tail_start, last, ids.clone()));
                    }
                    break;
                }
            }
        }
        i = j;
    }
    blocks
}

pub(super) fn analyze(
    path: &str,
    origin: f64,
    models: &Path,
    samples: &[NativeSubjectSample],
    cancel: &AtomicBool,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<Report, NativeVisionError> {
    let started = Instant::now();
    let mut report = Report::default();
    let blocks = blocks(samples);
    if !blocks.is_empty() {
        if let Err(error) = run(
            path,
            origin,
            models,
            samples,
            &blocks,
            cancel,
            &mut report,
            progress,
        ) {
            report.samples.clear();
            report.disabled_reason = Some(error.to_string());
            log::warn!("Active speaker analysis: {error}");
        }
    }
    if cancel.load(Ordering::Acquire) {
        return Err(NativeVisionError::new(
            "cancelled",
            "Speaker analysis cancelled",
            false,
        ));
    }
    report.elapsed_ms = started.elapsed().as_millis() as u64;
    report.peak_working_set_mib = super::super::diagnostics::resource_counters()
        .map_or(0, |r| r.peak_working_set_mib);
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
fn run(
    path: &str,
    origin: f64,
    models: &Path,
    samples: &[NativeSubjectSample],
    blocks: &[(usize, usize, Vec<u64>)],
    cancel: &AtomicBool,
    report: &mut Report,
    progress: &mut impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<()> {
    let mut reader = Reader::open(path)?;
    let mut session = open_ort_session(&models.join("light_asd_ava_25.onnx"))?;
    let mfcc = mfcc::Mfcc::new();
    let total_blocks = blocks.len();
    for (block_idx, (first, last, ids)) in blocks.iter().enumerate() {
        ensure!(!cancel.load(Ordering::Relaxed), "cancelled");
        let slice = &samples[*first..=*last];
        if progress(NativeVisionProgress {
            phase: "speaker",
            percent: 90 + ((block_idx * 10) / total_blocks.max(1)).min(9),
            timestamp_sec: slice[0].time,
            eta_seconds: None,
            face_sample: None,
            subject_sample: None,
            face_samples: None,
            subject_samples: None,
            queued_detections: samples.len(),
        })
        .is_err()
        {
            cancel.store(true, Ordering::Release);
            anyhow::bail!("cancelled");
        }
        let started = Instant::now();
        let input = match reader.read(origin, slice, ids, cancel) {
            Ok(inputs) => inputs,
            Err(error) => {
                if cancel.load(Ordering::Relaxed) {
                    return Err(error);
                }
                report.skipped_blocks += 1;
                log::debug!("Skipped speaker window at {}: {error}", slice[0].time);
                continue;
            }
        };
        report.decode_ms += started.elapsed().as_millis() as u64;
        // `Reader::read` guarantees at least FPS frames (one full window).
        let frames = input.faces[0].len() / (SIDE * SIDE);
        let mut scores: Vec<Vec<Score>> = (0..slice.len()).map(|_| Vec::with_capacity(ids.len())).collect();
        // Tail windows overlap. Assign shared frames to the window with more context.
        let mut confidence = vec![vec![0.0; frames]; ids.len()];
        let mut context = vec![None; frames];
        let mut start = 0;
        loop {
            ensure!(!cancel.load(Ordering::Relaxed), "cancelled");
            let prep = Instant::now();
            let pcm = &input.pcm
                [start * AUDIO_SAMPLES_PER_FRAME..(start + FPS) * AUDIO_SAMPLES_PER_FRAME];
            let usable = pcm.iter().all(|v| v.is_finite());
            let quiet = usable && pcm.iter().all(|v| v.abs() < 8.0);
            let features = (usable && !quiet).then(|| mfcc.compute(pcm));
            report.features_ms += prep.elapsed().as_millis() as u64;
            let inference = Instant::now();
            let mut predictions = Vec::new();
            if let Some(features) = features.as_ref() {
                let a = TensorRef::from_array_view(([1, 100, 13], features.as_slice()))?;
                for crops in &input.faces {
                    ensure!(!cancel.load(Ordering::Relaxed), "cancelled");
                    let pixels: Vec<f32> = crops
                        [start * SIDE * SIDE..(start + FPS) * SIDE * SIDE]
                        .iter()
                        .map(|&x| f32::from(x))
                        .collect();
                    let v = TensorRef::from_array_view(([1, 25, 112, 112], pixels.as_slice()))?;
                    let outputs = session.run(ort::inputs!["mfcc" => &*a, "face" => v])?;
                    let (_, values) = outputs["speaking"].try_extract_tensor::<f32>()?;
                    ensure!(
                        values.len() == FPS
                            && values.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)),
                        "unexpected Light-ASD output"
                    );
                    predictions.push(values.to_vec());
                }
                report.windows += 1;
            }
            report.inference_ms += inference.elapsed().as_millis() as u64;
            if usable {
                for k in 0..FPS {
                    let margin = k.min(FPS - 1 - k);
                    if context[start + k].is_some_and(|prev| prev >= margin) {
                        continue;
                    }
                    context[start + k] = Some(margin);
                    for (face, values) in confidence.iter_mut().enumerate() {
                        values[start + k] = if quiet { 0.0 } else { predictions[face][k] };
                    }
                }
            }
            if start + FPS == frames {
                break;
            }
            start = (start + FPS).min(frames - FPS);
        }
        report.analyzed_seconds += frames as f64 / FPS as f64;
        for (index, sample) in slice.iter().enumerate() {
            // Average the probability over this detection sample's 200ms neighborhood.
            let center = ((sample.time - slice[0].time) * FPS as f64).round() as usize;
            let lo = center.saturating_sub(2).min(frames - 1);
            let hi = (center + 3).min(frames);
            if lo >= hi || context[lo..hi].iter().any(Option::is_none) {
                continue;
            }
            for (&track_id, p) in ids.iter().zip(&confidence) {
                scores[index].push(Score {
                    track_id,
                    confidence: p[lo..hi].iter().sum::<f32>() / (hi - lo) as f32,
                });
            }
            // Adjacent and tail-extended blocks may overlap already-scored indices.
            if report
                .samples
                .last()
                .is_some_and(|row| row.index >= first + index)
            {
                continue;
            }
            report.samples.push(SampleScores {
                index: first + index,
                scores: std::mem::take(&mut scores[index]),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video::smart_crop::vision_logic::{AutoFlipFaceDetection, NormalizedBox};

    fn make_face(id: Option<u64>, predicted: Option<bool>) -> AutoFlipFaceDetection {
        AutoFlipFaceDetection {
            box_: NormalizedBox {
                x: 0.1,
                y: 0.1,
                width: 0.2,
                height: 0.2,
            },
            keypoints: Vec::new(),
            track_id: id,
            predicted,
            score: 0.9,
        }
    }

    fn make_sample(
        time: f64,
        ids: &[u64],
        scene_cut: Option<bool>,
    ) -> NativeSubjectSample {
        NativeSubjectSample {
            time,
            detections: Vec::new(),
            autoflip_faces: ids.iter().map(|&id| make_face(Some(id), None)).collect(),
            pose_subjects: Vec::new(),
            importance_signals: Vec::new(),
            model_id: "test",
            scene_cut,
            camera_motion_residual: None,
        }
    }

    #[test]
    fn blocks_skips_single_face_and_short_spans() {
        let single: Vec<_> = (0..10)
            .map(|i| make_sample(i as f64 * 0.2, &[1], None))
            .collect();
        assert!(blocks(&single).is_empty());

        let short: Vec<_> = (0..5)
            .map(|i| make_sample(i as f64 * 0.2, &[1, 2], None))
            .collect();
        // 0.0 to 0.8s < 0.96s
        assert!(blocks(&short).is_empty());
    }

    #[test]
    fn blocks_splits_on_scene_cut_and_keeps_tail_samples() {
        // 27 samples (0.0 .. 5.2s) with 2 faces -> chunk size 24 -> (0, 24) plus tail block ending at 26.
        let mut samples: Vec<_> = (0..27)
            .map(|i| make_sample(i as f64 * 0.2, &[1, 2], None))
            .collect();
        let b = blocks(&samples);
        assert_eq!(b.len(), 2);
        assert_eq!((b[0].0, b[0].1), (0, 24));
        assert_eq!(b[1].1, 26);
        assert!(samples[b[1].1].time - samples[b[1].0].time >= MIN_BLOCK_SPAN_SEC);

        // Insert a scene cut at sample 10 -> two separate spans (0..=9 and 10..=26).
        samples[10].scene_cut = Some(true);
        let cut_blocks = blocks(&samples);
        assert_eq!(cut_blocks.len(), 2);
        assert_eq!((cut_blocks[0].0, cut_blocks[0].1), (0, 9));
        assert_eq!((cut_blocks[1].0, cut_blocks[1].1), (10, 26));
    }

    #[test]
    fn observed_ids_rejects_predicted_and_duplicates_skips_untracked() {
        let mut s = make_sample(0.0, &[1, 2], None);
        s.autoflip_faces.push(make_face(Some(3), Some(true)));
        assert_eq!(observed_ids(&s), vec![1, 2]);

        let dup = make_sample(0.0, &[1, 1], None);
        assert!(observed_ids(&dup).is_empty());

        let mut untracked = make_sample(0.0, &[1, 2], None);
        untracked.autoflip_faces.push(make_face(None, None));
        assert_eq!(observed_ids(&untracked), vec![1, 2]);
    }

    #[test]
    fn fill_tiny_audio_gaps_interpolates_only_small_holes() {
        let mut pcm = vec![10.0, f32::NAN, f32::NAN, 40.0];
        media::fill_tiny_audio_gaps(&mut pcm);
        assert!((pcm[1] - 20.0).abs() < 1e-4);
        assert!((pcm[2] - 30.0).abs() < 1e-4);

        let mut large = vec![10.0; 20];
        for slot in &mut large[2..15] {
            *slot = f32::NAN;
        }
        media::fill_tiny_audio_gaps(&mut large);
        assert!(large[5].is_nan());
    }

    #[test]
    fn analyze_disables_gracefully_when_model_missing() {
        let samples: Vec<_> = (0..8)
            .map(|i| make_sample(i as f64 * 0.2, &[1, 2], None))
            .collect();
        let report = analyze(
            "nonexistent-file.mp4",
            0.0,
            Path::new("nonexistent-dir"),
            &samples,
            &AtomicBool::new(false),
            &mut |_| Ok(()),
        )
        .expect("missing media/model should gracefully disable rather than fail");
        assert!(report.samples.is_empty());
        assert!(report.disabled_reason.is_some());
    }

    #[test]
    fn analyze_returns_cancelled_error_when_flag_set() {
        let samples: Vec<_> = (0..8)
            .map(|i| make_sample(i as f64 * 0.2, &[1, 2], None))
            .collect();
        let err = analyze(
            "nonexistent-file.mp4",
            0.0,
            Path::new("nonexistent-dir"),
            &samples,
            &AtomicBool::new(true),
            &mut |_| Ok(()),
        )
        .expect_err("cancelled run must return cancelled error");
        assert_eq!(err.code, "cancelled");
    }

    #[test]
    fn onnx_model_loads_and_outputs_valid_probabilities() {
        let models_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/clipper-vision");
        let model_path = models_dir.join("light_asd_ava_25.onnx");
        assert!(model_path.is_file(), "missing bundled {}", model_path.display());

        let mut session = open_ort_session(&model_path).expect("open Light-ASD ORT session");
        let mfcc_data = vec![0.0_f32; 100 * 13];
        let face_data = vec![110.0_f32; 25 * 112 * 112];
        let a = TensorRef::from_array_view(([1, 100, 13], mfcc_data.as_slice())).unwrap();
        let v = TensorRef::from_array_view(([1, 25, 112, 112], face_data.as_slice())).unwrap();
        let outputs = session
            .run(ort::inputs!["mfcc" => a, "face" => v])
            .expect("Light-ASD inference");
        let (_, values) = outputs["speaking"].try_extract_tensor::<f32>().unwrap();
        assert_eq!(values.len(), FPS);
        assert!(
            values.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)),
            "expected probabilities in [0, 1], got {values:?}"
        );
    }

    #[test]
    #[ignore = "runs end-to-end pipeline A/B benchmark on OPEN_CLIPPER_ASD_BENCHMARK_VIDEO"]
    fn benchmark_active_speaker_on_video() {
        use std::sync::Arc;
        use crate::video::smart_crop::pipeline::{analyze as analyze_pipeline, VisionAblationConfig};

        let video_path = std::env::var("OPEN_CLIPPER_ASD_BENCHMARK_VIDEO")
            .expect("set OPEN_CLIPPER_ASD_BENCHMARK_VIDEO");
        let start: f64 = std::env::var("OPEN_CLIPPER_ASD_START")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0);
        let end: f64 = std::env::var("OPEN_CLIPPER_ASD_END")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15.0);
        let detect_speaker = std::env::var("OPEN_CLIPPER_ASD_ENABLE")
            .map(|v| v != "0" && v != "false")
            .unwrap_or(true);
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR"));

        let mut subjects = Vec::new();
        let summary = analyze_pipeline(
            video_path,
            start,
            end,
            resource_dir,
            Arc::new(AtomicBool::new(false)),
            true,
            detect_speaker,
            VisionAblationConfig::default(),
            |update| {
                subjects.extend(update.subject_samples.into_iter().flatten());
                Ok(())
            },
        )
        .expect("pipeline analysis");

        if let Some(report) = summary.active_speaker.as_ref() {
            let high_conf = report
                .samples
                .iter()
                .filter(|row| {
                    let mut sorted: Vec<f32> = row.scores.iter().map(|s| s.confidence).collect();
                    sorted.sort_by(|a, b| b.total_cmp(a));
                    sorted.len() >= 2 && sorted[0] >= 0.6 && (sorted[0] - sorted[1]) >= 0.1
                })
                .count();
            println!(
                "ASD_BENCH asd=1 range={start:.1}..{end:.1}s subjects={} total_ms={} speaker_ms={} decode_ms={} features_ms={} inference_ms={} analyzed_s={:.2} windows={} skipped={} scored={} clear_winner={} peak_mib={} disabled={:?}",
                subjects.len(),
                summary.metrics.analysis_duration_ms,
                report.elapsed_ms,
                report.decode_ms,
                report.features_ms,
                report.inference_ms,
                report.analyzed_seconds,
                report.windows,
                report.skipped_blocks,
                report.samples.len(),
                high_conf,
                report.peak_working_set_mib,
                report.disabled_reason,
            );
            for row in report.samples.iter().take(20) {
                let t = subjects.get(row.index).map_or(-1.0, |s| s.time);
                println!("  sample[{}] t={t:.2}s scores={:?}", row.index, row.scores);
            }
            assert!(
                report.disabled_reason.is_none(),
                "unexpected disabled_reason: {:?}",
                report.disabled_reason
            );
        } else {
            println!(
                "ASD_BENCH asd=0 range={start:.1}..{end:.1}s subjects={} total_ms={}",
                subjects.len(),
                summary.metrics.analysis_duration_ms,
            );
        }
    }
}
