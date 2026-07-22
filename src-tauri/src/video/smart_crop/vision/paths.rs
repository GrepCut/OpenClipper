use std::path::{Path, PathBuf};

pub struct VisionResourcePaths {
    pub face: PathBuf,
    pub pose: PathBuf,
    pub yolox: PathBuf,
    pub yolox_labels: PathBuf,
    pub transnet: PathBuf,
    pub osnet: PathBuf,
    pub vinet: PathBuf,
}

pub fn resource_paths(resource_dir: &Path) -> VisionResourcePaths {
    let root = resource_dir.join("resources/models/clipper-vision");
    VisionResourcePaths {
        face: root.join("blaze_face_full_range.onnx"),
        pose: root.join("movenet_multipose_lightning.onnx"),
        yolox: root.join("yolox_tiny.onnx"),
        yolox_labels: root.join("coco80.txt"),
        transnet: root.join("transnetv2.onnx"),
        osnet: root.join("osnet_x0_25_msmt17.onnx"),
        vinet: root.join("vinet-s-saliency.onnx"),
    }
}

/// The optional fp16 sibling of an fp32 model file ("x.onnx" → "x.fp16.onnx").
pub fn fp16_variant_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("fp16.onnx")
}
