use std::path::Path;

use windows::core::HSTRING;

use super::super::com::MtaApartment;
use super::super::device_cache::device_cache;
use super::super::session::load_model;
use super::super::types::{
    ModelPrecision, NativeVisionDevice, NativeVisionError, SessionConfig, VisionModel,
};
use super::WinMlModel;

impl WinMlModel {
    #[cfg_attr(not(test), allow(dead_code))]
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
}
