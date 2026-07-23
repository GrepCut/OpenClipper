use super::types::NormalizedBox;

/// Cheap scene-local motion proposal used when a learned video-saliency model
/// is unavailable. Global changes are rejected as camera motion/cuts; the
/// connected component around the strongest residual cell becomes the action
/// proposal consumed by the importance ranker.
pub fn detect_motion_saliency(
    previous: &[u8],
    current: &[u8],
    width: usize,
    height: usize,
) -> Option<(NormalizedBox, f32)> {
    const COLS: usize = 16;
    const ROWS: usize = 9;
    if width < COLS
        || height < ROWS
        || previous.len() < width * height * 3
        || current.len() < width * height * 3
    {
        return None;
    }
    let mut previous_cells = vec![0.0f32; COLS * ROWS];
    let mut current_cells = vec![0.0f32; COLS * ROWS];
    for row in 0..ROWS {
        let y0 = row * height / ROWS;
        let y1 = ((row + 1) * height / ROWS).max(y0 + 1);
        for col in 0..COLS {
            let x0 = col * width / COLS;
            let x1 = ((col + 1) * width / COLS).max(x0 + 1);
            let mut previous_total = 0u64;
            let mut current_total = 0u64;
            let mut count = 0u64;
            for y in (y0..y1).step_by(2) {
                for x in (x0..x1).step_by(2) {
                    let index = (y * width + x) * 3;
                    previous_total += (previous[index] as u64 * 3
                        + previous[index + 1] as u64 * 6
                        + previous[index + 2] as u64)
                        / 10;
                    current_total += (current[index] as u64 * 3
                        + current[index + 1] as u64 * 6
                        + current[index + 2] as u64)
                        / 10;
                    count += 1;
                }
            }
            previous_cells[row * COLS + col] = previous_total as f32 / count.max(1) as f32;
            current_cells[row * COLS + col] = current_total as f32 / count.max(1) as f32;
        }
    }
    // Coarse camera-motion compensation. Find the scene-wide translation
    // with the smallest robust luma residual, then search for foreground
    // residuals only inside the mutually visible area. This follows the same
    // camera/foreground separation used by MediaPipe MotionAnalysis without
    // adding an optical-flow dependency to the native worker.
    let mut best_shift = (0isize, 0isize);
    let mut best_cost = f32::INFINITY;
    for dy in -3isize..=3 {
        for dx in -4isize..=4 {
            let mut residuals = Vec::with_capacity(COLS * ROWS);
            for row in 0..ROWS {
                for col in 0..COLS {
                    let previous_row = row as isize - dy;
                    let previous_col = col as isize - dx;
                    if previous_row < 0
                        || previous_row >= ROWS as isize
                        || previous_col < 0
                        || previous_col >= COLS as isize
                    {
                        continue;
                    }
                    residuals.push(
                        (current_cells[row * COLS + col]
                            - previous_cells[previous_row as usize * COLS + previous_col as usize])
                            .abs(),
                    );
                }
            }
            if residuals.len() < COLS * ROWS / 2 {
                continue;
            }
            residuals.sort_by(f32::total_cmp);
            // A trimmed mean is insensitive to the foreground object whose
            // residual we want to retain after camera compensation.
            let keep = residuals.len() * 3 / 4;
            let cost = residuals[..keep].iter().sum::<f32>() / keep.max(1) as f32;
            if cost < best_cost {
                best_cost = cost;
                best_shift = (dx, dy);
            }
        }
    }
    let mut energy = vec![0.0f32; COLS * ROWS];
    for row in 0..ROWS {
        for col in 0..COLS {
            let previous_row = row as isize - best_shift.1;
            let previous_col = col as isize - best_shift.0;
            if previous_row < 0
                || previous_row >= ROWS as isize
                || previous_col < 0
                || previous_col >= COLS as isize
            {
                continue;
            }
            energy[row * COLS + col] = (current_cells[row * COLS + col]
                - previous_cells[previous_row as usize * COLS + previous_col as usize])
                .abs();
        }
    }
    let mut ordered = energy.clone();
    ordered.sort_by(f32::total_cmp);
    let median = ordered[ordered.len() / 2];
    let (peak_index, peak) = energy
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    // A high median means most of the image changed: a cut, flash or camera
    // move is not a local narrative target.
    if median > 28.0 || peak < median + 12.0 || peak < 16.0 {
        return None;
    }
    let threshold = (median + 9.0).max(peak * 0.52);
    let mut visited = [false; COLS * ROWS];
    let mut stack = vec![peak_index];
    let mut left = COLS;
    let mut right = 0usize;
    let mut top = ROWS;
    let mut bottom = 0usize;
    while let Some(index) = stack.pop() {
        if visited[index] || energy[index] < threshold {
            continue;
        }
        visited[index] = true;
        let row = index / COLS;
        let col = index % COLS;
        left = left.min(col);
        right = right.max(col + 1);
        top = top.min(row);
        bottom = bottom.max(row + 1);
        if col > 0 {
            stack.push(index - 1);
        }
        if col + 1 < COLS {
            stack.push(index + 1);
        }
        if row > 0 {
            stack.push(index - COLS);
        }
        if row + 1 < ROWS {
            stack.push(index + COLS);
        }
    }
    if left >= right || top >= bottom {
        return None;
    }
    let margin_x = 1.0 / COLS as f32;
    let margin_y = 1.0 / ROWS as f32;
    let x = (left as f32 / COLS as f32 - margin_x).max(0.0);
    let y = (top as f32 / ROWS as f32 - margin_y).max(0.0);
    let right_norm = (right as f32 / COLS as f32 + margin_x).min(1.0);
    let bottom_norm = (bottom as f32 / ROWS as f32 + margin_y).min(1.0);
    Some((
        NormalizedBox {
            x,
            y,
            width: right_norm - x,
            height: bottom_norm - y,
        },
        ((peak - median) / 64.0).clamp(0.0, 1.0),
    ))
}
