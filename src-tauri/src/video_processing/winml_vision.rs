//! Thin synchronous WinML session wrapper. Instances are created and used on
//! one dedicated MTA worker thread by the native Clipper pipeline.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::AI::MachineLearning::{
    LearningModel, LearningModelBinding, LearningModelDevice, LearningModelDeviceKind,
    LearningModelSession, LearningModelSessionOptions, TensorFloat,
};

/// Fixed batch size every session is compiled for. The bundled models expose
/// a free "batch" dimension; pinning it via OverrideNamedDimension lets
/// WinML precompile a static DirectML graph (free dimensions force a
/// re-plan on every Evaluate, which is dramatically slower). All callers
/// must pad their tensors to this bound.
pub const BATCH_BOUND: usize = 8;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum VisionModel {
    Face,
    Object,
    YoloX,
    ActiveSpeaker,
    Pose,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum NativeVisionDevice {
    #[serde(rename = "directx-high-performance")]
    DirectXHighPerformance,
    #[serde(rename = "cpu")]
    Cpu,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModelPrecision {
    Float32,
    Float16,
}

/// Winning (device, precision) pair from calibration, reused by later sessions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionConfig {
    pub device: NativeVisionDevice,
    pub precision: ModelPrecision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVisionError {
    pub code: &'static str,
    pub message: String,
    pub fatal: bool,
}

impl NativeVisionError {
    pub fn new(code: &'static str, message: impl Into<String>, fatal: bool) -> Self {
        Self {
            code,
            message: message.into(),
            fatal,
        }
    }
}

impl std::fmt::Display for NativeVisionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NativeVisionError {}

struct MtaApartment;

impl MtaApartment {
    fn initialize() -> Result<Self, NativeVisionError> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| {
                winml_error("cpu_session_failed", "MTA initialization failed", error)
            })?;
        Ok(Self)
    }
}

impl Drop for MtaApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

static DEVICE_CACHE: OnceLock<Mutex<HashMap<VisionModel, SessionConfig>>> = OnceLock::new();

fn device_cache() -> &'static Mutex<HashMap<VisionModel, SessionConfig>> {
    DEVICE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn winml_error(
    code: &'static str,
    context: &str,
    error: windows::core::Error,
) -> NativeVisionError {
    NativeVisionError::new(code, format!("{context}: {error}"), true)
}

fn fallback_after_evaluation_failure(device: NativeVisionDevice) -> Option<NativeVisionDevice> {
    (device == NativeVisionDevice::DirectXHighPerformance).then_some(NativeVisionDevice::Cpu)
}

struct Session {
    value: LearningModelSession,
    config: SessionConfig,
}

impl Session {
    fn close(&self) {
        let _ = self.value.Close();
    }
}

/// Creates a session compiled for exactly `bound` frames per call by pinning
/// the model's free "batch" dimension. Precompiled static graphs are the
/// whole point: leaving the dimension free forces DirectML to re-plan on
/// every Evaluate.
fn make_bound_session(
    model: &LearningModel,
    device: &LearningModelDevice,
    bound: usize,
) -> windows::core::Result<LearningModelSession> {
    match LearningModelSessionOptions::new().and_then(|options| {
        options.OverrideNamedDimension(&HSTRING::from("batch"), bound as u32)?;
        LearningModelSession::CreateFromModelOnDeviceWithSessionOptions(model, device, &options)
    }) {
        Ok(session) => Ok(session),
        // Fallback for models without the named dimension (or an OS without
        // OverrideNamedDimension): a plain session still works, it just
        // re-plans per shape.
        Err(_) => LearningModelSession::CreateFromModelOnDevice(model, device),
    }
}

pub struct WinMlModel {
    kind: VisionModel,
    model: LearningModel,
    /// Compiled for BATCH_BOUND frames per call.
    session: Session,
    /// Lazily compiled for exactly one frame per call, so partial pipelines
    /// never pay for padded batch evaluations.
    single_session: Option<LearningModelSession>,
    fp32_path: PathBuf,
    input_name: HSTRING,
    output_names: Vec<HSTRING>,
    // Must be declared last so WinRT objects are released before COM is
    // uninitialized during field drop after `Drop::drop` returns.
    _apartment: MtaApartment,
}

fn load_model(path: &Path) -> Result<LearningModel, NativeVisionError> {
    LearningModel::LoadFromFilePath(&HSTRING::from(path.as_os_str().to_string_lossy().as_ref()))
        .map_err(|error| winml_error("model_missing", "WinML could not load model", error))
}

impl WinMlModel {
    pub fn create_multi(
        kind: VisionModel,
        path: &Path,
        output_names: &[&str],
    ) -> Result<Self, NativeVisionError> {
        let apartment = MtaApartment::initialize()?;
        let model = load_model(path)?;
        let config = SessionConfig {
            device: NativeVisionDevice::Cpu,
            precision: ModelPrecision::Float32,
        };
        let session = Self::make_session(&model, config)?;
        Ok(Self {
            kind,
            model,
            session,
            single_session: None,
            fp32_path: path.to_path_buf(),
            input_name: HSTRING::new(),
            output_names: output_names.iter().map(|name| HSTRING::from(*name)).collect(),
            _apartment: apartment,
        })
    }

    pub fn create(
        kind: VisionModel,
        path: &Path,
        fp16_path: Option<&Path>,
        input_name: &str,
        output_names: &[&str],
        first_shape: &[i64],
        first_input: &[f32],
    ) -> Result<(Self, Vec<Vec<f32>>), NativeVisionError> {
        let apartment = MtaApartment::initialize()?;
        let input_hstring = HSTRING::from(input_name);
        let output_hstrings: Vec<HSTRING> = output_names
            .iter()
            .map(|name| HSTRING::from(*name))
            .collect();
        let fp16_path = fp16_path.filter(|path| path.is_file());
        let cached = device_cache()
            .lock()
            .ok()
            .and_then(|cache| cache.get(&kind).copied());

        // Calibration benchmarks cheap single-frame sessions; the device
        // ranking carries over to the retained batch session.
        let requested_bound = first_shape.first().copied().unwrap_or(1).max(1) as usize;
        let per_frame = first_input.len() / requested_bound;
        let mut single_shape = first_shape.to_vec();
        single_shape[0] = 1;
        let single_input = &first_input[..per_frame];

        let (model, config) = if let Some(config) = cached {
            let model_path = match config.precision {
                ModelPrecision::Float16 => fp16_path.unwrap_or(path),
                ModelPrecision::Float32 => path,
            };
            (load_model(model_path)?, config)
        } else {
            Self::calibrate(
                path,
                fp16_path,
                &input_hstring,
                &output_hstrings,
                &single_shape,
                single_input,
            )?
        };
        let session = Self::make_session(&model, config)?;
        if let Ok(mut cache) = device_cache().lock() {
            cache.insert(kind, session.config);
        }
        let mut created = Self {
            kind,
            model,
            session,
            single_session: None,
            fp32_path: path.to_path_buf(),
            input_name: input_hstring,
            output_names: output_hstrings,
            _apartment: apartment,
        };
        let first_outputs = created.evaluate(first_shape, first_input)?;
        Ok((created, first_outputs))
    }

    fn error_code(device: NativeVisionDevice) -> &'static str {
        if device == NativeVisionDevice::Cpu {
            "cpu_session_failed"
        } else {
            "directx_unavailable"
        }
    }

    fn device_for(config: SessionConfig) -> Result<LearningModelDevice, NativeVisionError> {
        let kind = match config.device {
            NativeVisionDevice::Cpu => LearningModelDeviceKind::Cpu,
            NativeVisionDevice::DirectXHighPerformance => {
                LearningModelDeviceKind::DirectXHighPerformance
            }
        };
        LearningModelDevice::Create(kind).map_err(|error| {
            winml_error(
                Self::error_code(config.device),
                "WinML device creation failed",
                error,
            )
        })
    }

    fn make_session(
        model: &LearningModel,
        config: SessionConfig,
    ) -> Result<Session, NativeVisionError> {
        let model_device = Self::device_for(config)?;
        let value = make_bound_session(model, &model_device, BATCH_BOUND).map_err(|error| {
            winml_error(
                Self::error_code(config.device),
                "WinML session creation failed",
                error,
            )
        })?;
        Ok(Session { value, config })
    }

    fn evaluate_session(
        session: &LearningModelSession,
        input_name: &HSTRING,
        output_names: &[HSTRING],
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        Self::evaluate_session_named(session, &[(input_name, shape, input)], output_names)
    }

    fn evaluate_session_named(
        session: &LearningModelSession,
        inputs: &[(&HSTRING, &[i64], &[f32])],
        output_names: &[HSTRING],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let binding = LearningModelBinding::CreateFromSession(session).map_err(|error| {
            winml_error("evaluation_failed", "Could not create WinML binding", error)
        })?;
        for (input_name, shape, input) in inputs {
            let tensor = TensorFloat::CreateFromShapeArrayAndDataArray(shape, input).map_err(|error| {
                winml_error(
                    "tensor_contract_mismatch",
                    "Could not create input tensor",
                    error,
                )
            })?;
            binding.Bind(input_name, &tensor).map_err(|error| {
                winml_error(
                    "tensor_contract_mismatch",
                    "Could not bind input tensor",
                    error,
                )
            })?;
        }
        let result = session
            .Evaluate(&binding, &HSTRING::new())
            .map_err(|error| winml_error("evaluation_failed", "WinML evaluation failed", error))?;
        if !result.Succeeded().unwrap_or(false) {
            return Err(NativeVisionError::new(
                "evaluation_failed",
                format!("WinML status {}", result.ErrorStatus().unwrap_or(-1)),
                true,
            ));
        }
        let outputs = result.Outputs().map_err(|error| {
            winml_error("evaluation_failed", "Could not read WinML outputs", error)
        })?;
        output_names
            .iter()
            .map(|name| {
                let inspectable = outputs.Lookup(name).map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Missing output {name}"),
                        error,
                    )
                })?;
                let tensor: TensorFloat = inspectable.cast().map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Output {name} is not float32"),
                        error,
                    )
                })?;
                let view = tensor.GetAsVectorView().map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Cannot map output {name}"),
                        error,
                    )
                })?;
                let mut data = vec![0.0; view.Size().unwrap_or(0) as usize];
                view.GetMany(0, &mut data).map_err(|error| {
                    winml_error(
                        "tensor_contract_mismatch",
                        &format!("Cannot copy output {name}"),
                        error,
                    )
                })?;
                Ok(data)
            })
            .collect()
    }

    /// Benchmarks fp32-CPU, fp32-DirectX, and (when present) fp16-DirectX
    /// with cheap single-frame sessions and returns the fastest
    /// (model, config); the ranking carries over to the retained batch
    /// session. fp16 parity with fp32 is validated offline by
    /// scripts/models/make_derived_clipper_vision_models.py.
    fn calibrate(
        fp32_path: &Path,
        fp16_path: Option<&Path>,
        input_name: &HSTRING,
        output_names: &[HSTRING],
        shape: &[i64],
        input: &[f32],
    ) -> Result<(LearningModel, SessionConfig), NativeVisionError> {
        let benchmark = |session: &LearningModelSession| -> Result<Vec<u128>, NativeVisionError> {
            for _ in 0..2 {
                Self::evaluate_session(session, input_name, output_names, shape, input)?;
            }
            let mut times = Vec::with_capacity(5);
            for _ in 0..5 {
                let started = Instant::now();
                Self::evaluate_session(session, input_name, output_names, shape, input)?;
                times.push(started.elapsed().as_micros());
            }
            times.sort_unstable();
            Ok(times)
        };
        let try_config = |model: &LearningModel, config: SessionConfig| -> Option<Vec<u128>> {
            let device = Self::device_for(config).ok()?;
            let session = make_bound_session(model, &device, 1).ok()?;
            let times = benchmark(&session).ok();
            let _ = session.Close();
            times
        };

        let fp32_model = load_model(fp32_path)?;
        let cpu_config = SessionConfig {
            device: NativeVisionDevice::Cpu,
            precision: ModelPrecision::Float32,
        };
        let cpu_device = Self::device_for(cpu_config)?;
        let cpu_session = make_bound_session(&fp32_model, &cpu_device, 1).map_err(|error| {
            winml_error("cpu_session_failed", "WinML session creation failed", error)
        })?;
        let cpu_times = benchmark(&cpu_session)?;
        let _ = cpu_session.Close();

        let mut best_model = fp32_model.clone();
        let mut best = (cpu_config, cpu_times);
        let directx_fp32 = SessionConfig {
            device: NativeVisionDevice::DirectXHighPerformance,
            precision: ModelPrecision::Float32,
        };
        if let Some(times) = try_config(&fp32_model, directx_fp32) {
            if times[2] < best.1[2] {
                best = (directx_fp32, times);
            }
        }
        if let Some(fp16_path) = fp16_path {
            if let Ok(fp16_model) = load_model(fp16_path) {
                let directx_fp16 = SessionConfig {
                    device: NativeVisionDevice::DirectXHighPerformance,
                    precision: ModelPrecision::Float16,
                };
                if let Some(times) = try_config(&fp16_model, directx_fp16) {
                    if times[2] < best.1[2] {
                        best = (directx_fp16, times);
                        best_model = fp16_model;
                    }
                }
            }
        }
        Ok((best_model, best.0))
    }

    /// Evaluates a tensor whose leading dimension is 1 or BATCH_BOUND — the
    /// two batch sizes sessions are compiled for.
    pub fn evaluate(
        &mut self,
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        match self.evaluate_once(shape, input) {
            Ok(outputs) => Ok(outputs),
            Err(_)
                if fallback_after_evaluation_failure(self.session.config.device)
                    == Some(NativeVisionDevice::Cpu) =>
            {
                self.session.close();
                if let Some(single) = self.single_session.take() {
                    let _ = single.Close();
                }
                // The failing session may have been running the fp16 variant;
                // the CPU fallback always goes back to the fp32 model.
                if self.session.config.precision == ModelPrecision::Float16 {
                    let _ = self.model.Close();
                    self.model = load_model(&self.fp32_path)?;
                }
                let fallback = SessionConfig {
                    device: NativeVisionDevice::Cpu,
                    precision: ModelPrecision::Float32,
                };
                self.session = Self::make_session(&self.model, fallback)?;
                if let Ok(mut cache) = device_cache().lock() {
                    cache.insert(self.kind, fallback);
                }
                self.evaluate_once(shape, input)
            }
            Err(error) => Err(error),
        }
    }

    pub fn evaluate_named(
        &mut self,
        inputs: &[(&str, &[i64], &[f32])],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let batch = inputs.first().and_then(|input| input.1.first()).copied().unwrap_or(1) as usize;
        if batch != 1 && batch != BATCH_BOUND {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {batch}"),
                true,
            ));
        }
        if batch == 1 && self.single_session.is_none() {
            let device = Self::device_for(self.session.config)?;
            self.single_session = Some(make_bound_session(&self.model, &device, 1).map_err(|error| {
                winml_error(Self::error_code(self.session.config.device), "WinML session creation failed", error)
            })?);
        }
        let names = inputs.iter().map(|input| HSTRING::from(input.0)).collect::<Vec<_>>();
        let bound = inputs.iter().enumerate().map(|(index, input)| (&names[index], input.1, input.2)).collect::<Vec<_>>();
        let session = if batch == 1 {
            self.single_session.as_ref().expect("created above")
        } else {
            &self.session.value
        };
        Self::evaluate_session_named(session, &bound, &self.output_names)
    }

    fn evaluate_once(
        &mut self,
        shape: &[i64],
        input: &[f32],
    ) -> Result<Vec<Vec<f32>>, NativeVisionError> {
        let bound = shape.first().copied().unwrap_or(1) as usize;
        if bound == BATCH_BOUND {
            return Self::evaluate_session(
                &self.session.value,
                &self.input_name,
                &self.output_names,
                shape,
                input,
            );
        }
        if bound != 1 {
            return Err(NativeVisionError::new(
                "tensor_contract_mismatch",
                format!("Unsupported batch size {bound}"),
                true,
            ));
        }
        if self.single_session.is_none() {
            let device = Self::device_for(self.session.config)?;
            let session = make_bound_session(&self.model, &device, 1).map_err(|error| {
                winml_error(
                    Self::error_code(self.session.config.device),
                    "WinML session creation failed",
                    error,
                )
            })?;
            self.single_session = Some(session);
        }
        Self::evaluate_session(
            self.single_session.as_ref().expect("created above"),
            &self.input_name,
            &self.output_names,
            shape,
            input,
        )
    }

    pub fn device(&self) -> NativeVisionDevice {
        self.session.config.device
    }
}

impl Drop for WinMlModel {
    fn drop(&mut self) {
        self.session.close();
        if let Some(single) = self.single_session.take() {
            let _ = single.Close();
        }
        let _ = self.model.Close();
    }
}

pub struct VisionResourcePaths {
    pub face: PathBuf,
    pub ssd: PathBuf,
    pub pose: PathBuf,
    pub ssd_labels: PathBuf,
    pub yolox: PathBuf,
    pub yolox_labels: PathBuf,
    pub active_speaker: PathBuf,
}

pub fn resource_paths(resource_dir: &Path) -> VisionResourcePaths {
    let root = resource_dir.join("resources/models/clipper-vision");
    VisionResourcePaths {
        face: root.join("blaze_face_full_range.onnx"),
        ssd: root.join("ssdlite_object_detection.onnx"),
        pose: root.join("movenet_multipose_lightning.onnx"),
        ssd_labels: root.join("ssdlite_object_detection_labelmap.txt"),
        yolox: root.join("yolox_tiny.onnx"),
        yolox_labels: root.join("coco80.txt"),
        active_speaker: root.join("lr_asd_ava.onnx"),
    }
}

/// The optional fp16 sibling of an fp32 model file ("x.onnx" → "x.fp16.onnx").
pub fn fp16_variant_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("fp16.onnx")
}

#[cfg(test)]
mod tests {
    use super::*;

    const CPU_FP32: SessionConfig = SessionConfig {
        device: NativeVisionDevice::Cpu,
        precision: ModelPrecision::Float32,
    };

    #[test]
    fn lr_asd_accepts_named_audio_and_face_inputs() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        let mut model = WinMlModel::create_multi(
            VisionModel::ActiveSpeaker,
            &root.join("lr_asd_ava.onnx"),
            &["speaker_probability"],
        ).expect("load LR-ASD");
        let audio = vec![0.0f32; 100 * 13];
        let faces = vec![0.0f32; 25 * 112 * 112];
        let outputs = model.evaluate_named(&[
            ("audio_mfcc", &[1, 100, 13], &audio),
            ("face_gray", &[1, 25, 112, 112], &faces),
        ]).expect("evaluate LR-ASD");
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].len(), 25);
        assert!(outputs[0].iter().all(|score| score.is_finite() && *score >= 0.0 && *score <= 1.0));
    }

    #[test]
    fn yolox_dynamic_batch_evaluates_with_winml() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        let input = vec![114.0f32; 3 * 416 * 416];
        let (model, outputs) = WinMlModel::create(
            VisionModel::YoloX,
            &root.join("yolox_tiny.onnx"),
            None,
            "images",
            &["output"],
            &[1, 3, 416, 416],
            &input,
        ).expect("evaluate YOLOX");
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].len(), 3549 * 85);
        drop(model);
    }

    #[test]
    fn bundled_models_load_and_evaluate_with_winml() {
        let _apartment = MtaApartment::initialize().expect("MTA");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        let face_input = vec![0.0f32; BATCH_BOUND * 192 * 192 * 3];
        eprintln!("loading face");
        let face_model = load_model(&root.join("blaze_face_full_range.onnx")).expect("load face");
        eprintln!("creating face cpu session");
        let face = WinMlModel::make_session(&face_model, CPU_FP32).expect("face CPU session");
        eprintln!("evaluating face");
        let face_outputs = WinMlModel::evaluate_session(
            &face.value,
            &HSTRING::from("input"),
            &[
                HSTRING::from("reshaped_regressor_face_4"),
                HSTRING::from("reshaped_classifier_face_4"),
            ],
            &[BATCH_BOUND as i64, 192, 192, 3],
            &face_input,
        )
        .expect("BlazeFace must evaluate with WinML");
        assert_eq!(face_outputs[0].len(), BATCH_BOUND * 2304 * 16);
        assert_eq!(face_outputs[1].len(), BATCH_BOUND * 2304);
        face.close();
        let _ = face_model.Close();
        drop(face);

        let object_input = vec![0.0f32; BATCH_BOUND * 320 * 320 * 3];
        eprintln!("loading object");
        let object_model =
            load_model(&root.join("ssdlite_object_detection.onnx")).expect("load object");
        let object = WinMlModel::make_session(&object_model, CPU_FP32).expect("object CPU session");
        eprintln!("evaluating object");
        let object_outputs = WinMlModel::evaluate_session(
            &object.value,
            &HSTRING::from("normalized_input_image_tensor"),
            &[
                HSTRING::from("raw_outputs/box_encodings"),
                HSTRING::from("raw_outputs/class_predictions"),
            ],
            &[BATCH_BOUND as i64, 320, 320, 3],
            &object_input,
        )
        .expect("SSD Lite must evaluate with WinML");
        assert_eq!(object_outputs[0].len(), BATCH_BOUND * 2034 * 4);
        assert_eq!(object_outputs[1].len(), BATCH_BOUND * 2034 * 91);

        let pose_input = vec![0.0f32; 512 * 512 * 3];
        eprintln!("loading pose");
        let pose_model =
            load_model(&root.join("movenet_multipose_lightning.onnx")).expect("load pose");
        let pose = WinMlModel::make_session(&pose_model, CPU_FP32).expect("pose CPU session");
        let pose_outputs = WinMlModel::evaluate_session(
            &pose.value,
            &HSTRING::from("input"),
            &[HSTRING::from("output_0")],
            &[1, 512, 512, 3],
            &pose_input,
        )
        .expect("MoveNet must evaluate with WinML");
        assert_eq!(pose_outputs[0].len(), 6 * 56);
    }

    #[test]
    fn bundled_fp16_models_load_with_winml() {
        let _apartment = MtaApartment::initialize().expect("MTA");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        for name in [
            "blaze_face_full_range.onnx",
            "ssdlite_object_detection.onnx",
        ] {
            let path = fp16_variant_path(&root.join(name));
            assert!(path.is_file(), "missing fp16 variant {}", path.display());
            let model = load_model(&path).expect("fp16 model must load");
            let _ = model.Close();
        }
    }

    #[test]
    fn batched_evaluation_isolates_frames() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        let elements = 192 * 192 * 3;
        // Two distinct frames at slots 0 and 1, padding elsewhere.
        let mut stacked = vec![-1.0f32; BATCH_BOUND * elements];
        for index in 0..elements {
            stacked[index] = ((index * 37 + 17) % 1021) as f32 / 1020.0 * 2.0 - 1.0;
            stacked[elements + index] = ((index * 37 + 118) % 1021) as f32 / 1020.0 * 2.0 - 1.0;
        }
        let (mut model, first) = WinMlModel::create(
            VisionModel::Face,
            &root.join("blaze_face_full_range.onnx"),
            None,
            "input",
            &["reshaped_regressor_face_4", "reshaped_classifier_face_4"],
            &[BATCH_BOUND as i64, 192, 192, 3],
            &stacked,
        )
        .expect("batch-bound session must create");
        assert_eq!(first[0].len(), BATCH_BOUND * 2304 * 16);

        // Swap the two frames; per-frame output slices must swap with them,
        // proving batch elements are evaluated independently.
        let mut swapped = stacked.clone();
        swapped.copy_within(elements..2 * elements, 0);
        for index in 0..elements {
            swapped[elements + index] = stacked[index];
        }
        let second = model
            .evaluate(&[BATCH_BOUND as i64, 192, 192, 3], &swapped)
            .expect("swapped batch evaluate");
        for output in 0..2 {
            let stride = first[output].len() / BATCH_BOUND;
            for (index, (actual, expected)) in second[output][..stride]
                .iter()
                .zip(&first[output][stride..2 * stride])
                .enumerate()
            {
                assert!(
                    (actual - expected).abs() < 1e-2,
                    "output {output} element {index}: {actual} vs {expected}"
                );
            }
        }
    }

    /// Prints single-frame vs batch throughput per model; opt in with
    /// `cargo test --release winml_batch_microbenchmark -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn winml_batch_microbenchmark() {
        // Keeps the MTA (and WinML's cached activation factories) alive
        // across the per-model threads; in the app the webview holds COM.
        let _apartment = MtaApartment::initialize().expect("MTA");
        let cases = [
            (
                "blaze",
                "blaze_face_full_range.onnx",
                "input",
                ["reshaped_regressor_face_4", "reshaped_classifier_face_4"],
                192usize,
            ),
            (
                "ssd",
                "ssdlite_object_detection.onnx",
                "normalized_input_image_tensor",
                ["raw_outputs/box_encodings", "raw_outputs/class_predictions"],
                320usize,
            ),
        ];
        // Each model gets its own thread, mirroring the worker threads in
        // production (COM apartments are per-thread).
        fn run_case(
            (label, file, input_name, outputs, side): (
                &'static str,
                &'static str,
                &'static str,
                [&'static str; 2],
                usize,
            ),
        ) {
            let root =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
            let elements = side * side * 3;
            let single = vec![0.5f32; elements];
            let batched = vec![0.5f32; BATCH_BOUND * elements];
            let fp32 = root.join(file);
            let fp16 = fp16_variant_path(&fp32);
            let kind = if label == "blaze" {
                VisionModel::Face
            } else {
                VisionModel::Object
            };
            let (mut model, _) = WinMlModel::create(
                kind,
                &fp32,
                Some(&fp16),
                input_name,
                &outputs,
                &[1, side as i64, side as i64, 3],
                &single,
            )
            .expect("create");
            let shape1 = [1i64, side as i64, side as i64, 3];
            let shape8 = [BATCH_BOUND as i64, side as i64, side as i64, 3];
            for _ in 0..3 {
                model.evaluate(&shape1, &single).expect("warm single");
                model.evaluate(&shape8, &batched).expect("warm batch");
            }
            let runs = 20;
            let started = Instant::now();
            for _ in 0..runs {
                model.evaluate(&shape1, &single).expect("single");
            }
            let single_ms = started.elapsed().as_secs_f64() * 1000.0 / runs as f64;
            let started = Instant::now();
            for _ in 0..runs {
                model.evaluate(&shape8, &batched).expect("batch");
            }
            let batch_ms = started.elapsed().as_secs_f64() * 1000.0 / runs as f64;
            eprintln!(
                "{label}: device={:?} single={single_ms:.2}ms batch8={batch_ms:.2}ms \
                 ({:.2}ms/frame batched)",
                model.device(),
                batch_ms / BATCH_BOUND as f64,
            );
        }
        for case in cases {
            std::thread::spawn(move || run_case(case))
                .join()
                .expect("microbenchmark thread");
        }
    }

    #[test]
    fn automatic_device_calibration_is_process_safe() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/clipper-vision");
        let fp32 = root.join("blaze_face_full_range.onnx");
        let fp16 = fp16_variant_path(&fp32);
        let input = vec![0.0f32; BATCH_BOUND * 192 * 192 * 3];
        let (model, outputs) = WinMlModel::create(
            VisionModel::Face,
            &fp32,
            Some(&fp16),
            "input",
            &["reshaped_regressor_face_4", "reshaped_classifier_face_4"],
            &[BATCH_BOUND as i64, 192, 192, 3],
            &input,
        )
        .expect("CPU/DirectX calibration must retain a valid session");
        assert_eq!(outputs[0].len(), BATCH_BOUND * 2304 * 16);
        drop(model);
    }

    #[test]
    fn device_failure_demotes_only_directx() {
        assert_eq!(
            fallback_after_evaluation_failure(NativeVisionDevice::DirectXHighPerformance),
            Some(NativeVisionDevice::Cpu)
        );
        assert_eq!(
            fallback_after_evaluation_failure(NativeVisionDevice::Cpu),
            None
        );
    }
}
