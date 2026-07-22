/// Exact histogram shape used by MediaPipe AutoFlip ShotBoundaryCalculator.
/// Its OpenCV call passes `dims = 2`, so despite the three-channel constants
/// the effective histogram is the first two RGB channels (8×8).
pub(crate) fn compute_autoflip_histogram_raw(
    data: &[u8],
    stride: usize,
    width: usize,
    height: usize,
) -> [u32; 64] {
    let mut hist = [0u32; 64];
    for y in 0..height {
        let row_offset = y * stride;
        for x in 0..width {
            let idx = row_offset + x * 3;
            if idx + 2 >= data.len() {
                continue;
            }
            let r = (data[idx] >> 5) as usize;
            let g = (data[idx + 1] >> 5) as usize;
            hist[r * 8 + g] += 1;
        }
    }
    hist
}
