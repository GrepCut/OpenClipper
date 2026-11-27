//! Burned-in graphic bands at the top or bottom edge: title bars, lower thirds,
//! channel strips and letterboxing that carries a logo or text.
//!
//! `border.rs` only recognises bars whose rows are one solid colour, so a bar
//! with text on it stays part of the "content" and ends up in every crop. A
//! band is treated as a graphic only when all three tests hold; each one
//! rejects a different kind of real footage:
//!
//! 1. Static over time: the rows barely change between analysis samples.
//!    Rejects anything with people, camera motion or scrolling tickers.
//! 2. Flat background: one colour covers most of the band. Rejects a still,
//!    textured background (book shelves, walls of several video-call tiles).
//! 3. Sharp edge: a clear step between the band and the picture next to it.
//!    Rejects still scenery whose "stillness" fades out gradually (sky, wall).
//!
//! The thresholds were checked on podcasts with and without a title bar,
//! music videos, film trailers, sport and still landscape footage.

use super::border::dominant_color;

/// Column buckets per row: enough to notice a moving head, coarse enough to
/// average away compression noise.
const BUCKETS: usize = 32;
/// A bucket "changed" when its mean luma moves by more than this.
const CHANGE_LUMA: f32 = 4.0;
/// A static row may still change in this share of comparisons (a logo that
/// animates for a few seconds, a fade). People and camera motion change far
/// more often.
const MAX_CHANGE_SHARE: f64 = 0.10;
/// One colour covers at least this share of the band's pixels.
const MIN_DOMINANT_SHARE: f64 = 0.5;
/// Mean luma step between the band's edge row and the first picture row.
const MIN_EDGE_LUMA: f64 = 8.0;
/// Band depth limits as a share of the frame height.
const MIN_DEPTH_SHARE: f64 = 0.04;
const MAX_DEPTH_SHARE: f64 = 0.30;
/// About five seconds of analysis samples before any band is reported.
const MIN_COMPARISONS: u32 = 25;
/// A copy of the frame is kept this often for the flat-background test.
const KEEP_FRAME_EVERY: u32 = 50;

#[derive(Default)]
pub(crate) struct StaticBandDetector {
    width: usize,
    height: usize,
    previous: Vec<f32>,
    current: Vec<f32>,
    changed: Vec<u32>,
    edge: Vec<f64>,
    comparisons: u32,
    samples: u32,
    kept: Vec<u8>,
    kept_stride: usize,
    disabled: bool,
}

impl StaticBandDetector {
    pub(crate) fn observe(&mut self, rgb: &[u8], stride: usize, width: usize, height: usize) {
        if self.disabled
            || width < BUCKETS
            || height < 2
            || stride < width * 3
            || rgb.len() < stride * height
        {
            return;
        }
        if self.samples == 0 {
            self.width = width;
            self.height = height;
            self.changed = vec![0; height];
            self.edge = vec![0.0; height];
        } else if width != self.width || height != self.height {
            // The sample geometry never changes within one analysis; if it
            // ever does, report nothing rather than mix incompatible rows.
            self.disabled = true;
            return;
        }

        let bucket = width / BUCKETS;
        self.current.clear();
        self.current.resize(height * BUCKETS, 0.0);
        for y in 0..height {
            let row = &rgb[y * stride..y * stride + width * 3];
            for b in 0..BUCKETS {
                let mut sum = 0u32;
                for x in b * bucket..(b + 1) * bucket {
                    let offset = x * 3;
                    sum += 299 * row[offset] as u32 + 587 * row[offset + 1] as u32 + 114 * row[offset + 2] as u32;
                }
                self.current[y * BUCKETS + b] = sum as f32 / (1000.0 * bucket as f32);
            }
        }

        if !self.previous.is_empty() {
            for y in 0..height {
                let range = y * BUCKETS..(y + 1) * BUCKETS;
                let moved = self.current[range.clone()]
                    .iter()
                    .zip(&self.previous[range])
                    .any(|(now, before)| (now - before).abs() > CHANGE_LUMA);
                if moved {
                    self.changed[y] += 1;
                }
            }
            self.comparisons += 1;
        }
        for y in 1..height {
            let step: f32 = (0..BUCKETS)
                .map(|b| (self.current[y * BUCKETS + b] - self.current[(y - 1) * BUCKETS + b]).abs())
                .sum();
            self.edge[y] += (step / BUCKETS as f32) as f64;
        }
        if self.samples % KEEP_FRAME_EVERY == 0 {
            self.kept.clear();
            self.kept.extend_from_slice(&rgb[..stride * height]);
            self.kept_stride = stride;
        }
        std::mem::swap(&mut self.previous, &mut self.current);
        self.samples += 1;
    }

    /// Depth in sample pixels of the graphic band at the top and the bottom.
    pub(crate) fn finish(&self) -> (u32, u32) {
        (self.band(true), self.band(false))
    }

    fn band(&self, from_top: bool) -> u32 {
        if self.disabled || self.comparisons < MIN_COMPARISONS || self.kept.is_empty() {
            return 0;
        }
        let height = self.height;
        let limit = self.comparisons as f64 * MAX_CHANGE_SHARE;
        let mut depth = 0usize;
        for offset in 0..height {
            let y = if from_top { offset } else { height - 1 - offset };
            if self.changed[y] as f64 > limit {
                break;
            }
            depth += 1;
        }
        // A completely still frame is a slide or a still image, not a band.
        if depth == height
            || (depth as f64) < MIN_DEPTH_SHARE * height as f64
            || (depth as f64) > MAX_DEPTH_SHARE * height as f64
        {
            return 0;
        }
        let start = if from_top { 0 } else { height - depth };
        let (_, count) = dominant_color(&self.kept, self.kept_stride, self.width, start, depth);
        if (count as f64) < MIN_DOMINANT_SHARE * (self.width * depth) as f64 {
            return 0;
        }
        let boundary = if from_top { depth } else { height - depth };
        if self.edge[boundary] / (self.samples as f64) < MIN_EDGE_LUMA {
            return 0;
        }
        depth as u32
    }
}
