use std::path::{Path, PathBuf};

pub struct VisionResourcePaths {
    /// Bundled clipper-vision directory; face view files resolve against it.
    pub models: PathBuf,
    pub pose: PathBuf,
    pub yolox: PathBuf,
    pub yolox_labels: PathBuf,
}

pub fn resource_paths(resource_dir: &Path) -> VisionResourcePaths {
    let root = resource_dir.join("resources/models/clipper-vision");
    VisionResourcePaths {
        pose: root.join("movenet_multipose_lightning.onnx"),
        yolox: root.join("yolox_s.onnx"),
        yolox_labels: root.join("coco80.txt"),
        models: root,
    }
}

/// The optional fp16 sibling of an fp32 model file ("x.onnx" → "x.fp16.onnx").
pub fn fp16_variant_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("fp16.onnx")
}
