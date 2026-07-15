pub(crate) fn compute_rgb_histogram_raw(
    data: &[u8],
    stride: usize,
    width: usize,
    height: usize,
) -> [u32; 192] {
    let mut hist = [0u32; 192];
    for y in 0..height {
        let row_offset = y * stride;
        for x in 0..width {
            let idx = row_offset + x * 3;
            if idx + 2 >= data.len() {
                continue;
            }
            hist[(data[idx] >> 2) as usize] += 1;
            hist[64 + (data[idx + 1] >> 2) as usize] += 1;
            hist[128 + (data[idx + 2] >> 2) as usize] += 1;
        }
    }
    hist
}

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

pub(crate) fn cosine_similarity(a: &[u32; 192], b: &[u32; 192]) -> f32 {
    let (dot, na, nb) =
        a.iter()
            .zip(b.iter())
            .fold((0.0_f64, 0.0_f64, 0.0_f64), |(dot, na, nb), (&ai, &bi)| {
                let (ai_f, bi_f) = (ai as f64, bi as f64);
                (dot + ai_f * bi_f, na + ai_f * ai_f, nb + bi_f * bi_f)
            });

    if na == 0.0 || nb == 0.0 {
        return 1.0;
    }
    (dot / (na.sqrt() * nb.sqrt())) as f32
}

pub(crate) fn calculate_luminance_ratio(hist: &[u32; 192]) -> f32 {
    let r_lum = hist[24..40].iter().sum::<u32>();
    let g_lum = hist[88..104].iter().sum::<u32>();
    let b_lum = hist[152..168].iter().sum::<u32>();
    let total_lum = r_lum + g_lum + b_lum;
    let total_pixels = hist.iter().sum::<u32>().max(1) / 3;

    total_lum as f32 / total_pixels as f32
}
