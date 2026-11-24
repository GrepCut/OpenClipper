//! YuNet (MIT, OpenCV Zoo) multiscale face detector. Every sample is seen at
//! three scales — long side 384, a mirrored 960 and 1536 — computed by one
//! fused graph from a single uint8 canvas; per-view faces are fused by
//! cross-view agreement and calibrated onto the tracker score scale.

use super::multiscale::{
    calibrate_fused_score, greedy_face_nms, merge_face_views, unflip_face, MULTISCALE_VIEW_FLOOR,
};
use super::yunet::{decode_yunet_candidates, YUNET_OUTPUT_NAMES};
use super::{AutoFlipFaceDetection, Letterbox};

/// Minimum calibrated face score. The tracker's 0.5 / 0.6 / 0.7 thresholds
/// assume this scale.
const FACE_SCORE_THRESHOLD: f32 = 0.5;

/// Static input box of a view graph. Rectangular boxes fit 16:9 and 9:16
/// frames without padding; any other source uses the square box.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum FaceViewShape {
    Square,
    Landscape,
    Portrait,
}

/// One top-left letterboxed model pass over a frame or tile whose long side
/// is scaled to `size`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FaceView {
    pub size: usize,
    pub flip: bool,
    pub stem: &'static str,
    pub rectangular: bool,
}

impl FaceView {
    /// Short side of the rectangular boxes: 9/16 of the long side, rounded up
    /// to the coarsest stride.
    fn short_side(self) -> usize {
        (self.size * 9).div_ceil(16 * 32) * 32
    }

    /// Whether this view upscales a `width`×`height` source by at most 1.5×,
    /// the largest upscale validated on WIDER FACE (1536 px over ~1024 px).
    pub(crate) fn within_validated_upscale(self, width: u32, height: u32) -> bool {
        self.size * 2 <= width.max(height) as usize * 3
    }

    /// The box that letterboxes a `width`×`height` source with the least padding.
    pub(crate) fn shape_for(self, width: u32, height: u32) -> FaceViewShape {
        let fits = |long: u32, short: u32| short as usize * 16 <= long as usize * 9;
        if !self.rectangular {
            FaceViewShape::Square
        } else if width >= height && fits(width, height) {
            FaceViewShape::Landscape
        } else if height > width && fits(height, width) {
            FaceViewShape::Portrait
        } else {
            FaceViewShape::Square
        }
    }

    /// Input (width, height) of the graph for `shape`.
    pub(crate) fn dimensions(self, shape: FaceViewShape) -> (usize, usize) {
        match shape {
            FaceViewShape::Square => (self.size, self.size),
            FaceViewShape::Landscape => (self.size, self.short_side()),
            FaceViewShape::Portrait => (self.short_side(), self.size),
        }
    }

    /// Every shape this view has a bundled graph for.
    pub(crate) fn shapes(self) -> &'static [FaceViewShape] {
        if self.rectangular {
            &[
                FaceViewShape::Square,
                FaceViewShape::Landscape,
                FaceViewShape::Portrait,
            ]
        } else {
            &[FaceViewShape::Square]
        }
    }

    /// Bundled graph file for `shape`.
    pub(crate) fn file(self, shape: FaceViewShape) -> String {
        match shape {
            FaceViewShape::Square => format!("{}.onnx", self.stem),
            FaceViewShape::Landscape => format!("{}_landscape.onnx", self.stem),
            FaceViewShape::Portrait => format!("{}_portrait.onnx", self.stem),
        }
    }
}

/// The fused graph: uint8 RGB NHWC canvas of the 1536 view box in, twelve
/// YuNet heads per view out (see `scripts/models/prepare_yunet_multiscale.py`).
pub(crate) const FACE_CANVAS: FaceView = FaceView {
    size: 1536,
    flip: false,
    stem: "yunet_fused_1536",
    rectangular: true,
};

/// Views computed inside the fused graph, in output order. The graph mirrors
/// the 960 view as a whole box.
pub(crate) const FACE_CANVAS_VIEWS: [FaceView; 3] = [
    FaceView {
        size: 384,
        flip: false,
        stem: "yunet_384",
        rectangular: true,
    },
    FaceView {
        size: 960,
        flip: true,
        stem: "yunet_960",
        rectangular: true,
    },
    // In-graph only: no standalone yunet_1536 file is bundled.
    FaceView {
        size: 1536,
        flip: false,
        stem: "yunet_1536",
        rectangular: true,
    },
];

/// Square single-view graphs for 640 px recovery tiles and for sources too
/// small for the validated 1536 upscale. The 960 view mirrors its content.
pub(crate) const FACE_SINGLE_VIEWS: [FaceView; 2] = [
    FaceView {
        rectangular: false,
        ..FACE_CANVAS_VIEWS[0]
    },
    FaceView {
        rectangular: false,
        ..FACE_CANVAS_VIEWS[1]
    },
];

pub(crate) const FACE_CANVAS_INPUT: &str = "image";
pub(crate) const FACE_VIEW_INPUT: &str = "input";
pub(crate) const FACE_VIEW_OUTPUTS: &[&str] = &YUNET_OUTPUT_NAMES;

/// Fused graph outputs: the twelve YuNet heads of each canvas view, in view order.
pub(crate) const FACE_CANVAS_OUTPUTS: [&str; 36] = [
    "384_cls_8",
    "384_cls_16",
    "384_cls_32",
    "384_obj_8",
    "384_obj_16",
    "384_obj_32",
    "384_bbox_8",
    "384_bbox_16",
    "384_bbox_32",
    "384_kps_8",
    "384_kps_16",
    "384_kps_32",
    "960_cls_8",
    "960_cls_16",
    "960_cls_32",
    "960_obj_8",
    "960_obj_16",
    "960_obj_32",
    "960_bbox_8",
    "960_bbox_16",
    "960_bbox_32",
    "960_kps_8",
    "960_kps_16",
    "960_kps_32",
    "1536_cls_8",
    "1536_cls_16",
    "1536_cls_32",
    "1536_obj_8",
    "1536_obj_16",
    "1536_obj_32",
    "1536_bbox_8",
    "1536_bbox_16",
    "1536_bbox_32",
    "1536_kps_8",
    "1536_kps_16",
    "1536_kps_32",
];

/// Decodes canvas view `view_index` of a fused graph evaluation into
/// source-normalized faces. Mirrored views are unmirrored in box space.
pub(crate) fn decode_canvas_view(
    view_index: usize,
    shape: FaceViewShape,
    outputs: &[Vec<f32>],
    letterbox: Letterbox,
) -> Result<Vec<AutoFlipFaceDetection>, String> {
    let view = FACE_CANVAS_VIEWS[view_index];
    let heads = YUNET_OUTPUT_NAMES.len();
    let (width, height) = view.dimensions(shape);
    let candidates = decode_yunet_candidates(
        outputs
            .get(view_index * heads..(view_index + 1) * heads)
            .ok_or("tensor_contract_mismatch: fused YuNet output count")?,
        (width, height),
        letterbox,
        MULTISCALE_VIEW_FLOOR,
        view.flip.then_some(width as f32),
    )?;
    Ok(greedy_face_nms(candidates))
}

/// Decodes one square single-view evaluation; a mirrored view's content was
/// flipped during preprocessing and is unflipped here.
pub(crate) fn decode_single_view(
    view: FaceView,
    outputs: &[Vec<f32>],
    letterbox: Letterbox,
) -> Result<Vec<AutoFlipFaceDetection>, String> {
    let candidates = decode_yunet_candidates(
        outputs,
        view.dimensions(FaceViewShape::Square),
        letterbox,
        MULTISCALE_VIEW_FLOOR,
        None,
    )?;
    let kept = greedy_face_nms(candidates);
    Ok(if view.flip {
        kept.into_iter().map(unflip_face).collect()
    } else {
        kept
    })
}

/// Combines the per-view detections of one frame into final, calibrated faces.
pub(crate) fn fuse_views(views: Vec<Vec<AutoFlipFaceDetection>>) -> Vec<AutoFlipFaceDetection> {
    merge_face_views(views)
        .into_iter()
        .map(|mut face| {
            face.score = calibrate_fused_score(face.score);
            face
        })
        .filter(|face| face.score >= FACE_SCORE_THRESHOLD)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangular_boxes_follow_source_orientation() {
        assert_eq!(FACE_CANVAS.shape_for(1920, 1080), FaceViewShape::Landscape);
        assert_eq!(FACE_CANVAS.shape_for(1080, 1920), FaceViewShape::Portrait);
        assert_eq!(FACE_CANVAS.shape_for(1440, 1080), FaceViewShape::Square);
        assert_eq!(FACE_CANVAS.shape_for(640, 640), FaceViewShape::Square);
        assert_eq!(
            FACE_CANVAS.dimensions(FaceViewShape::Landscape),
            (1536, 864)
        );
        assert_eq!(
            FACE_CANVAS_VIEWS[1].dimensions(FaceViewShape::Portrait),
            (544, 960)
        );
        assert_eq!(
            FACE_CANVAS_VIEWS[0].dimensions(FaceViewShape::Landscape),
            (384, 224)
        );
        assert_eq!(
            FACE_SINGLE_VIEWS[1].shape_for(1920, 1080),
            FaceViewShape::Square
        );
    }

    #[test]
    fn canvas_outputs_hold_twelve_heads_per_view() {
        assert_eq!(
            FACE_CANVAS_OUTPUTS.len(),
            FACE_CANVAS_VIEWS.len() * YUNET_OUTPUT_NAMES.len()
        );
        for (index, view) in FACE_CANVAS_VIEWS.iter().enumerate() {
            for (head, name) in YUNET_OUTPUT_NAMES.iter().enumerate() {
                assert_eq!(
                    FACE_CANVAS_OUTPUTS[index * YUNET_OUTPUT_NAMES.len() + head],
                    format!("{}_{name}", view.size)
                );
            }
        }
    }
}
