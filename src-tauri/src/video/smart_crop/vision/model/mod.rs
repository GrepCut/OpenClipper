use std::path::PathBuf;

use windows::core::HSTRING;
use windows::AI::MachineLearning::{LearningModel, LearningModelSession};

use super::com::MtaApartment;
use super::session::Session;
use super::types::VisionModel;

mod calibrate;
mod context;
mod create;
mod drop;
mod evaluate;
mod memory_guard;
mod session;

use context::EvaluationContext;

pub struct WinMlModel {
    pub(super) kind: VisionModel,
    pub(super) model: Option<LearningModel>,
    /// Compiled for BATCH_BOUND frames per call.
    pub(super) session: Option<Session>,
    /// Lazily compiled for exactly one frame per call, so partial pipelines
    /// never pay for padded batch evaluations.
    pub(super) single_session: Option<LearningModelSession>,
    batch_context: Option<EvaluationContext>,
    single_context: Option<EvaluationContext>,
    pub(super) fp32_path: PathBuf,
    pub(super) input_name: HSTRING,
    pub(super) output_names: Vec<HSTRING>,
    pub(super) evaluation_count: usize,
    pub(super) session_generation: usize,
    // Must be declared last so WinRT objects are released before COM is
    // uninitialized during field drop after `Drop::drop` returns.
    pub(super) _apartment: MtaApartment,
}
