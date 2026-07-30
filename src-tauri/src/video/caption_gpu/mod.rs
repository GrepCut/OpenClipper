mod animate;
mod fonts;
mod frames;
mod layout;
mod render_frame;
mod scene;
mod style_map;

pub use frames::{render_caption_png_sequence, CaptionOverlaySpec};
pub use render_frame::{probe_caption_gpu, render_hello_png, resource_fonts_dir, CaptionGpuContext};
pub use scene::CaptionScene;
