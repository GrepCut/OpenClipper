use crate::storage::repository::export_repository::ClipperExportRecord;

pub const SOCIAL_FIELD_NAMES: [&str; 3] = ["title", "description", "hashtags"];

fn social_field_empty(record: &ClipperExportRecord, name: &str) -> bool {
    match name {
        "title" => record.social_title.trim().is_empty(),
        "description" => record.social_description.trim().is_empty(),
        "hashtags" => record.social_hashtags.trim().is_empty(),
        _ => false,
    }
}

pub fn missing_social_fields(record: &ClipperExportRecord) -> Vec<String> {
    SOCIAL_FIELD_NAMES
        .iter()
        .filter(|name| social_field_empty(record, name))
        .map(|name| (*name).to_string())
        .collect()
}

pub fn format_platform(format_id: &str) -> &'static str {
    match format_id {
        "youtube" => "youtube",
        "instagram" => "instagram",
        "tiktok" => "tiktok",
        "instagram-portrait" => "instagram",
        "twitter" => "twitter",
        _ => "unknown",
    }
}

pub fn publish_platform(format_id: &str) -> &'static str {
    match format_id {
        "youtube" => "youtube",
        "instagram" | "instagram-portrait" => "instagram",
        "tiktok" => "tiktok",
        "twitter" => "x",
        _ => "unknown",
    }
}

pub fn format_label(format_id: &str) -> &'static str {
    match format_id {
        "youtube" => "YouTube",
        "instagram" => "Instagram",
        "tiktok" => "TikTok",
        "instagram-portrait" => "Instagram Portrait",
        "twitter" => "X / Twitter",
        _ => "Unknown",
    }
}

fn strip_timestamp_prefix(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.starts_with('[') {
        if let Some(close) = trimmed.find(']') {
            let rest = trimmed[close + 1..].trim_start();
            if rest.len() < trimmed.len() {
                return rest.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn parse_timestamp_prefix(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let close = trimmed.find(']')?;
    let inner = trimmed[1..close].trim();
    let parts: Vec<&str> = inner.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let minutes = parts[0].parse::<u64>().ok()?;
    let seconds = parts[1].parse::<u64>().ok()?;
    Some(minutes as f64 * 60.0 + seconds as f64)
}

fn extract_stamps_from_transcript(transcript_timestamped: &str) -> Vec<f64> {
    transcript_timestamped
        .lines()
        .filter_map(parse_timestamp_prefix)
        .collect()
}

fn format_mm_ss(seconds: f64) -> String {
    let total = seconds.round().max(0.0) as u64;
    let minutes = total / 60;
    let secs = total % 60;
    format!("{}:{:02}", minutes, secs)
}

fn line_times_for_count(count: usize, stamps: &[f64], clip_duration_sec: f64) -> Vec<f64> {
    if count == 0 {
        return Vec::new();
    }

    let duration = if clip_duration_sec > 0.0 {
        clip_duration_sec
    } else {
        stamps.last().copied().unwrap_or(0.0)
    };

    if stamps.len() <= 1 {
        if count == 1 {
            return vec![0.0];
        }
        return (0..count)
            .map(|index| (index as f64) * duration / (count as f64 - 1.0))
            .collect();
    }

    let stamp_count = stamps.len();
    if count == 1 {
        return vec![stamps[0]];
    }

    (0..count)
        .map(|index| {
            let stamp_index = ((index as f64) * (stamp_count as f64 - 1.0) / (count as f64 - 1.0))
                as usize;
            stamps[stamp_index.min(stamp_count - 1)]
        })
        .collect()
}

/// Re-stamp description lines using transcript cues or even clip-duration spacing.
pub fn apply_description_timestamps(
    body: &str,
    transcript_timestamped: &str,
    clip_duration_sec: f64,
) -> String {
    let lines: Vec<String> = body
        .lines()
        .map(|line| strip_timestamp_prefix(line))
        .filter(|line| !line.is_empty())
        .collect();

    if lines.is_empty() {
        return String::new();
    }

    let stamps = extract_stamps_from_transcript(transcript_timestamped);
    let line_times = line_times_for_count(lines.len(), &stamps, clip_duration_sec);

    lines
        .iter()
        .enumerate()
        .map(|(index, line)| format!("[{}] {}", format_mm_ss(line_times[index]), line))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_even_distribution_when_transcript_has_single_stamp() {
        let body = "[0:00] line one\n[0:00] line two\n[0:00] line three";
        let transcript = "[0:00] entire clip transcript";
        let result = apply_description_timestamps(body, transcript, 60.0);
        assert_eq!(
            result,
            "[0:00] line one\n[0:30] line two\n[1:00] line three"
        );
    }

    #[test]
    fn apply_proportional_stamps_from_transcript() {
        let body = "first\nsecond\nthird";
        let transcript = "[0:00] a\n[0:18] b\n[0:36] c\n[0:54] d";
        let result = apply_description_timestamps(body, transcript, 70.0);
        assert_eq!(
            result,
            "[0:00] first\n[0:18] second\n[0:54] third"
        );
    }

    #[test]
    fn strips_existing_prefixes_before_re_stamping() {
        let body = "[0:00] wrong\n[0:00] also wrong";
        let transcript = "[0:00] a\n[0:10] b\n[0:20] c";
        let result = apply_description_timestamps(body, transcript, 20.0);
        assert_eq!(result, "[0:00] wrong\n[0:20] also wrong");
    }
}
