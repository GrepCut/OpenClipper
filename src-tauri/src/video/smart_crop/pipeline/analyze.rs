use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use super::super::diagnostics;
use super::super::vision::NativeVisionError;
use super::decode_session::DecodeSession;
use super::drain::drain_workers;
use super::merge::merge_samples;
use super::setup::PipelineSetup;
use super::summary::build_summary;
use super::types::{NativeVisionProgress, NativeVisionSummary};
use super::VisionAblationConfig;

pub fn analyze(
    file_path: String,
    start_time: f64,
    end_time: f64,
    resource_dir: &Path,
    cancelled: Arc<AtomicBool>,
    tracking_enabled: bool,
    vision_ablation: VisionAblationConfig,
    mut progress: impl FnMut(NativeVisionProgress) -> Result<(), NativeVisionError>,
) -> Result<NativeVisionSummary, NativeVisionError> {
    let analysis_started = Instant::now();
    diagnostics::start(&file_path, start_time, end_time, tracking_enabled);
    let result = (|| {
        if end_time <= start_time {
            return Err(NativeVisionError::new(
                "decode_failed",
                "Invalid analysis range",
                true,
            ));
        }
        diagnostics::append(
            "setup",
            &format!("preparing pipeline resources={}", resource_dir.display()),
        );
        let mut setup = PipelineSetup::prepare(
            resource_dir,
            cancelled.clone(),
            vision_ablation,
            &mut progress,
        )?;
        diagnostics::append("setup", "workers initialized");
        diagnostics::append("decode", "opening FFmpeg decode session");
        let mut session = DecodeSession::open(&file_path, start_time, end_time)?;
        let total_duration = session.total_duration();
        diagnostics::append(
            "decode",
            &format!("session opened total_duration={total_duration:.3}s"),
        );
        let decode_stats = session.run(&mut setup, cancelled.clone(), &mut progress)?;
        diagnostics::append(
            "decode",
            &format!(
                "decode complete samples={} decoded_frames={} duration_ms={} face_queue_peak={} object_queue_peak={}",
                decode_stats.sample_count,
                decode_stats.decoded_frame_count,
                decode_stats.decode_duration_ms,
                decode_stats.peak_face_queue,
                decode_stats.peak_object_queue,
            ),
        );
        let drain = drain_workers(
            setup,
            decode_stats.sample_count,
            total_duration,
            cancelled,
            &mut progress,
        )?;
        diagnostics::append(
            "drain",
            &format!(
                "workers drained face_results={} object_results={} duration_ms={}",
                drain.spool.face_count, drain.spool.object_count, drain.drain_duration_ms,
            ),
        );
        let drain_duration_ms = drain.drain_duration_ms;
        let face_preprocess_ms = drain.face_preprocess_ms;
        let pose_preprocess_ms = drain.pose_preprocess_ms;
        let worker_metrics = drain.worker_metrics;
        diagnostics::append("merge", "starting tracking and result merge");
        let merged_result = merge_samples(
            decode_stats.sample_count,
            &drain.spool,
            tracking_enabled,
            &mut progress,
        );
        drain.spool.cleanup();
        let merged = merged_result?;
        diagnostics::append(
            "merge",
            &format!(
                "merge complete faces={} subjects={} face_device={:?} object_device={:?} pose_device={:?}",
                merged.face_samples.len(),
                merged.subject_samples.len(),
                merged.face_device,
                merged.object_device,
                merged.pose_device,
            ),
        );
        build_summary(
            &session,
            decode_stats,
            drain_duration_ms,
            face_preprocess_ms,
            pose_preprocess_ms,
            worker_metrics,
            merged,
            tracking_enabled,
            analysis_started.elapsed().as_millis() as u64,
            &mut progress,
        )
    })();
    match &result {
        Ok(summary) => diagnostics::finish(&format!(
            "COMPLETE face_samples={} subject_samples={}",
            summary.face_sample_count, summary.subject_sample_count
        )),
        Err(error) => diagnostics::finish(&format!(
            "ERROR code={} fatal={} message={}",
            error.code, error.fatal, error.message
        )),
    }
    result
}

#[cfg(all(test, windows))]
mod windows_pipeline_soak_tests {
    use super::*;
    use crate::video::smart_crop::diagnostics;
    use crate::video::smart_crop::vision::NativeVisionDevice;

    #[test]
    #[ignore = "runs one native face benchmark case from OPEN_CLIPPER_FACE_BENCHMARK_DIR"]
    fn benchmark_face_detection() {
        use std::fs::{self, File};
        use std::io::BufWriter;

        #[derive(serde::Deserialize)]
        struct Video {
            id: String,
            path: String,
            ranges: [[f64; 2]; 1],
        }

        let output = std::path::PathBuf::from(
            std::env::var_os("OPEN_CLIPPER_FACE_BENCHMARK_DIR").expect("benchmark directory"),
        );
        let [video]: [Video; 1] = serde_json::from_slice(
            &fs::read(output.join("videos.json")).expect("benchmark videos"),
        )
        .expect("one video range per benchmark process");
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let [[start, end]] = video.ranges;
        println!("running {} {start:.1}–{end:.1}", video.id);
        let mut faces = Vec::new();
        let mut subjects = Vec::new();
        let summary = analyze(
            video.path,
            start,
            end,
            resource_dir,
            Arc::new(AtomicBool::new(false)),
            true,
            VisionAblationConfig::default(),
            |update| {
                faces.extend(update.face_samples.into_iter().flatten());
                subjects.extend(update.subject_samples.into_iter().flatten());
                Ok(())
            },
        )
        .unwrap_or_else(|error| panic!("{}: {error}", video.id));
        assert_eq!(faces.len(), summary.face_sample_count);
        assert_eq!(subjects.len(), summary.subject_sample_count);
        println!(
            "{} {}",
            video.id,
            serde_json::to_string(&summary.metrics).unwrap()
        );
        let file = File::create(output.join(format!("{}-0.json", video.id)))
            .expect("benchmark result file");
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(
            &mut writer,
            &serde_json::json!({
                "range": [start, end], "summary": summary,
                "faces": faces, "subjects": subjects,
            }),
        )
        .expect("serialize benchmark results");
        std::io::Write::flush(&mut writer).expect("write benchmark results");
    }

    #[test]
    #[ignore = "requires OPEN_CLIPPER_PIPELINE_SOAK_VIDEO and performs a real pipeline soak"]
    fn real_pipeline_bounds_resident_frames_and_stays_on_directml() {
        let Ok(video_path) = std::env::var("OPEN_CLIPPER_PIPELINE_SOAK_VIDEO") else {
            return;
        };
        if !Path::new(&video_path).is_file() {
            return;
        }
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let cancelled = Arc::new(AtomicBool::new(false));
        let baseline = diagnostics::resource_counters().expect("Windows resource counters");
        let summary = analyze(
            video_path,
            0.0,
            300.0,
            resource_dir,
            cancelled,
            true,
            VisionAblationConfig::default(),
            |_| Ok(()),
        )
        .expect("five-minute end-to-end pipeline soak");
        let final_snapshot = diagnostics::resource_counters().expect("Windows resource counters");

        assert_eq!(
            summary.object_device,
            NativeVisionDevice::DirectXHighPerformance
        );
        assert_eq!(
            summary.face_device,
            NativeVisionDevice::DirectXHighPerformance
        );
        assert!(
            summary.subject_sample_count >= 1_400,
            "expected approximately 1500 object samples, got {}",
            summary.subject_sample_count
        );
        assert!(
            final_snapshot.private_commit_mib <= baseline.private_commit_mib + 4 * 1024,
            "end-to-end private commit is unexpectedly high: baseline={} final={}",
            baseline.private_commit_mib,
            final_snapshot.private_commit_mib
        );
    }
}
