use std::path::PathBuf;

use windows::core::HSTRING;
use windows::AI::MachineLearning::{LearningModel, LearningModelSession};

use super::com::MtaApartment;
use super::session::Session;
use super::types::VisionModel;

mod calibrate;
mod create;
mod drop;
mod evaluate;
mod session;

pub struct WinMlModel {
    pub(super) kind: VisionModel,
    pub(super) model: LearningModel,
    /// Compiled for BATCH_BOUND frames per call.
    pub(super) session: Session,
    /// Lazily compiled for exactly one frame per call, so partial pipelines
    /// never pay for padded batch evaluations.
    pub(super) single_session: Option<LearningModelSession>,
    pub(super) fp32_path: PathBuf,
    pub(super) input_name: HSTRING,
    pub(super) output_names: Vec<HSTRING>,
    // Must be declared last so WinRT objects are released before COM is
    // uninitialized during field drop after `Drop::drop` returns.
    pub(super) _apartment: MtaApartment,
}
