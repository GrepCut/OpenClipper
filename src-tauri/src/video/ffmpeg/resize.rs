//! Shared SIMD RGB resize via `fast_image_resize`.

use fast_image_resize::images::Image;
use fast_image_resize::{
    FilterType as FirFilterType, PixelType, ResizeAlg, ResizeOptions, Resizer,
};

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
    let mut output = vec![0; dst_width as usize * dst_height as usize * 3];
    resize_rgb_u8_into(
        rgb,
        src_width,
        src_height,
        dst_width,
        dst_height,
        &mut output,
    );
    output
}

/// Bilinear resize into a caller-owned interleaved RGB buffer.
///
/// The output is deliberately supplied by the caller so long-lived video
/// workers can reuse their scratch storage rather than allocating one image
/// per sampled frame.
pub(crate) fn resize_rgb_u8_into(
    rgb: &[u8],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
    output: &mut [u8],
) {
    let required = dst_width as usize * dst_height as usize * 3;
    assert_eq!(output.len(), required, "validated RGB destination buffer");
    if src_width == dst_width && src_height == dst_height {
        output.copy_from_slice(rgb);
        return;
    }
    let src_len = rgb.len();
    // SAFETY: resize only reads source pixels; the API requires a mutable borrow.
    let src_mut = unsafe { std::slice::from_raw_parts_mut(rgb.as_ptr() as *mut u8, src_len) };
    let src_image = Image::from_slice_u8(src_width, src_height, src_mut, PixelType::U8x3)
        .expect("validated RGB buffer");
    let mut dst_image = Image::from_slice_u8(dst_width, dst_height, output, PixelType::U8x3)
        .expect("validated RGB destination buffer");
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilterType::Bilinear));
    RGB_RESIZER.with(|resizer| {
        resizer
            .borrow_mut()
            .resize(&src_image, &mut dst_image, Some(&options))
            .expect("RGB resize");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_owned_output_matches_allocating_resize() {
        for (src_width, src_height, dst_width, dst_height) in
            [(4, 3, 4, 3), (4, 3, 7, 5), (7, 5, 4, 3)]
        {
            let rgb = (0..src_width as usize * src_height as usize * 3)
                .map(|index| (index * 37 % 251) as u8)
                .collect::<Vec<_>>();
            let expected = resize_rgb_u8(&rgb, src_width, src_height, dst_width, dst_height);
            let mut actual = vec![0xA5; dst_width as usize * dst_height as usize * 3];

            resize_rgb_u8_into(
                &rgb,
                src_width,
                src_height,
                dst_width,
                dst_height,
                &mut actual,
            );

            assert_eq!(actual, expected);
        }
    }
}
