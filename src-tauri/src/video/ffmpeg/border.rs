/// Lightweight, deterministic port of the decision part of MediaPipe's
/// `BorderDetectionCalculator`.  The reference uses OpenCV k-means to find a
/// dominant RGB cluster; the desktop pipeline has no OpenCV dependency, so a
/// 6-bit RGB histogram is used for the same question: does one colour occupy
/// enough of the sampled frame, and do the top/bottom rows retain that colour?
///
/// This deliberately reports only the static features needed by AutoFlip's
/// scene decision. Rendering padding is a separate concern and must not be
/// enabled merely because a single frame happens to be nearly monochrome.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct BorderFeatures {
    pub(crate) top_border_px: u32,
    pub(crate) bottom_border_px: u32,
    pub(crate) has_solid_background: bool,
    pub(crate) solid_background_rgb: Option<(u8, u8, u8)>,
}

const COLOR_TOLERANCE: i16 = 6;
const MIN_BORDER_DISTANCE: u32 = 5;
const MAX_SEARCH_PERCENT_NUMERATOR: u32 = 20;
const MAX_SEARCH_PERCENT_DENOMINATOR: u32 = 100;
const BORDER_MATCH_FRACTION_NUMERATOR: usize = 995;
const BORDER_MATCH_FRACTION_DENOMINATOR: usize = 1000;
const SOLID_BACKGROUND_FRACTION_NUMERATOR: usize = 1;
const SOLID_BACKGROUND_FRACTION_DENOMINATOR: usize = 2;

type Rgb = (u8, u8, u8);

fn quantized_bin(rgb: Rgb) -> usize {
    let (r, g, b) = rgb;
    ((r >> 6) as usize) << 4 | ((g >> 6) as usize) << 2 | (b >> 6) as usize
}

fn pixel(data: &[u8], stride: usize, x: usize, y: usize) -> Rgb {
    let offset = y * stride + x * 3;
    (data[offset], data[offset + 1], data[offset + 2])
}

fn dominant_color(
    data: &[u8],
    stride: usize,
    width: usize,
    y_start: usize,
    rows: usize,
) -> (Rgb, usize) {
    let mut bins = [0usize; 64];
    let mut sums = [(0usize, 0usize, 0usize); 64];
    for y in y_start..y_start + rows {
        for x in 0..width {
            let rgb = pixel(data, stride, x, y);
            let bin = quantized_bin(rgb);
            bins[bin] += 1;
            sums[bin].0 += rgb.0 as usize;
            sums[bin].1 += rgb.1 as usize;
            sums[bin].2 += rgb.2 as usize;
        }
    }
    let (bin, count) = bins
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .unwrap_or((0, 0));
    if count == 0 {
        return ((0, 0, 0), 0);
    }
    (
        (
            (sums[bin].0 / count) as u8,
            (sums[bin].1 / count) as u8,
            (sums[bin].2 / count) as u8,
        ),
        count,
    )
}

fn row_matches_color(data: &[u8], stride: usize, width: usize, y: usize, color: Rgb) -> bool {
    let matched = (0..width)
        .filter(|x| {
            let current = pixel(data, stride, *x, y);
            (current.0 as i16 - color.0 as i16).abs() <= COLOR_TOLERANCE
                && (current.1 as i16 - color.1 as i16).abs() <= COLOR_TOLERANCE
                && (current.2 as i16 - color.2 as i16).abs() <= COLOR_TOLERANCE
        })
        .count();
    matched * BORDER_MATCH_FRACTION_DENOMINATOR >= width * BORDER_MATCH_FRACTION_NUMERATOR
}

fn border_depth(data: &[u8], stride: usize, width: usize, height: usize, from_top: bool) -> u32 {
    let seed_y = if from_top { 0 } else { height - 1 };
    let (color, _) = dominant_color(data, stride, width, seed_y, 1);
    let max_search =
        (height as u32 * MAX_SEARCH_PERCENT_NUMERATOR / MAX_SEARCH_PERCENT_DENOMINATOR) as usize;
    let mut depth = 0usize;
    for offset in 0..max_search {
        let y = if from_top {
            offset
        } else {
            height - offset - 1
        };
        if !row_matches_color(data, stride, width, y, color) {
            break;
        }
        depth = offset + 1;
    }
    // AutoFlip rejects an all-frame match and borders <= 5 px.  There is no
    // object-padding addition here because these values are only evidence for
    // scene-level decisions, not final crop coordinates yet.
    if depth as u32 <= MIN_BORDER_DISTANCE || depth == max_search {
        0
    } else {
        depth as u32
    }
}

pub(crate) fn detect_border_features(
    data: &[u8],
    stride: usize,
    width: usize,
    height: usize,
) -> BorderFeatures {
    if width == 0 || height == 0 || stride < width * 3 || data.len() < stride * height {
        return BorderFeatures::default();
    }
    let top_border_px = border_depth(data, stride, width, height, true);
    let bottom_border_px = border_depth(data, stride, width, height, false);
    // BorderDetectionCalculator evaluates the dominant colour after it removes
    // static borders.  Otherwise black letterboxing would incorrectly be
    // classified as a solid content background.
    let non_static_start = top_border_px as usize;
    let non_static_rows = height.saturating_sub(top_border_px as usize + bottom_border_px as usize);
    let (dominant, count) = dominant_color(
        data,
        stride,
        width,
        non_static_start,
        non_static_rows.max(1),
    );
    let total = width * non_static_rows.max(1);
    let has_solid_background =
        count * SOLID_BACKGROUND_FRACTION_DENOMINATOR > total * SOLID_BACKGROUND_FRACTION_NUMERATOR;
    BorderFeatures {
        top_border_px,
        bottom_border_px,
        has_solid_background,
        solid_background_rgb: has_solid_background.then_some(dominant),
    }
}
