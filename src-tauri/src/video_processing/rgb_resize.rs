//! Shared SIMD RGB resize via `fast_image_resize`.

use fast_image_resize::images::Image;
use fast_image_resize::{FilterType as FirFilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};

thread_local! {
    static RGB_RESIZER: std::cell::RefCell<Resizer> = std::cell::RefCell::new(Resizer::new());
}

/// Bilinear resize of an interleaved RGB buffer.
pub(crate) fn resize_rgb_u8(
    rgb: &[u8],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Vec<u8> {
    if src_width == dst_width && src_height == dst_height {
        return rgb.to_vec();
    }
    let src_len = rgb.len();
    // SAFETY: resize only reads source pixels; the API requires a mutable borrow.
    let src_mut = unsafe { std::slice::from_raw_parts_mut(rgb.as_ptr() as *mut u8, src_len) };
    let src_image = Image::from_slice_u8(src_width, src_height, src_mut, PixelType::U8x3)
        .expect("validated RGB buffer");
    let mut dst_image = Image::new(dst_width, dst_height, PixelType::U8x3);
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilterType::Bilinear));
    RGB_RESIZER.with(|resizer| {
        resizer
            .borrow_mut()
            .resize(&src_image, &mut dst_image, Some(&options))
            .expect("RGB resize");
    });
    dst_image.into_vec()
}
