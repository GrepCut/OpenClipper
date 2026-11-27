//! Port of yt-dlp's HTTPS format handling (`_extract_formats_and_subtitles`),
//! the relevant `FormatSorter` fields and the `bv*+ba/b` format selection.

use super::{
    clients::media_origin,
    extract::{truthy, PlayerResponse},
    player::{Challenges, Solutions},
};
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;
use std::{cmp::Ordering, collections::HashSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stream {
    itag: Option<u64>,
    #[serde(default)]
    mime_type: String,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    bitrate: Option<u64>,
    average_bitrate: Option<u64>,
    content_length: Option<String>,
    approx_duration_ms: Option<String>,
    quality: Option<String>,
    quality_label: Option<String>,
    audio_quality: Option<String>,
    audio_sample_rate: Option<String>,
    audio_channels: Option<u32>,
    audio_track: Option<AudioTrack>,
    #[serde(default)]
    is_drc: bool,
    drm_families: Option<Value>,
    target_duration_sec: Option<Value>,
    #[serde(rename = "type")]
    stream_type: Option<String>,
    url: Option<String>,
    signature_cipher: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioTrack {
    id: Option<String>,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    audio_is_default: bool,
}

pub(super) struct Format {
    pub url: Url,
    pub file_size: Option<u64>,
    pub available_at: u64,
    pub has_video: bool,
    pub has_audio: bool,
    /// MP4 with H.264 up to 1080p and/or AAC: what the editor can open.
    compatible: bool,
    // Sorting fields, named as in yt-dlp.
    preference: i32,
    quality: f64,
    res: u32,
    fps: Option<u32>,
    source_preference: i32,
    channels: Option<u32>,
    language_preference: i32,
    size: Option<u64>,
    bitrate: Option<u64>,
    sample_rate: Option<u64>,
    id: String,
}

pub(super) struct Selection {
    pub video: Format,
    /// `None` when the video format already carries the audio.
    pub audio: Option<Format>,
}

fn streams(response: &PlayerResponse) -> impl Iterator<Item = Stream> + '_ {
    ["/streamingData/formats", "/streamingData/adaptiveFormats"]
        .into_iter()
        .filter_map(move |pointer| response.data.pointer(pointer)?.as_array())
        .flatten()
        .filter_map(|value| Stream::deserialize(value).ok())
}

/// The URL of a stream and, for a ciphered one, `(query parameter, signature)`.
fn stream_url(stream: &Stream) -> (Option<String>, Option<(String, String)>) {
    if let Some(url) = stream.url.as_ref().filter(|url| !url.is_empty()) {
        return (Some(url.clone()), None);
    }
    let mut url = None;
    let mut signature = None;
    let mut parameter = None;
    let cipher = stream.signature_cipher.as_deref().unwrap_or_default();
    for (key, value) in url::form_urlencoded::parse(cipher.as_bytes()) {
        match &*key {
            "url" => url = url.or(Some(value.into_owned())),
            "s" => signature = signature.or(Some(value.into_owned())),
            "sp" => parameter = Some(value.into_owned()),
            _ => {}
        }
    }
    let signature = signature.map(|signature| {
        (
            parameter.unwrap_or_else(|| "signature".to_owned()),
            signature,
        )
    });
    // Without both parts a ciphered stream cannot be used.
    match signature {
        Some(signature) => (url, Some(signature)),
        None => (None, None),
    }
}

fn throttle_challenge(url: &Url) -> Option<String> {
    url.query_pairs()
        .find(|(key, value)| key == "n" && !value.is_empty())
        .map(|(_, value)| value.into_owned())
}

/// Every `n` and signature challenge of all responses, to solve them in one run.
pub(super) fn challenges(responses: &[PlayerResponse]) -> Challenges {
    let mut challenges = Challenges::default();
    for stream in responses.iter().flat_map(streams) {
        let (url, signature) = stream_url(&stream);
        if let Some((_, signature)) = signature {
            challenges
                .signature_lengths
                .insert(signature.chars().count());
        }
        if let Some(n) = url
            .and_then(|url| Url::parse(&url).ok())
            .and_then(|url| throttle_challenge(&url))
        {
            challenges.n.insert(n);
        }
    }
    challenges
}

/// The stream's final URL, or `None` when a challenge has no solution.
fn solved_url(stream: &Stream, solutions: &Solutions, has_player: bool) -> Option<Url> {
    let (url, signature) = stream_url(stream);
    let mut url = Url::parse(&url?).ok()?;
    if let Some((parameter, signature)) = signature {
        if !has_player {
            return None;
        }
        let input: Vec<char> = signature.chars().collect();
        let solved = solutions
            .signature
            .get(&input.len())?
            .iter()
            .map(|index| input.get(*index))
            .collect::<Option<String>>()?;
        url.query_pairs_mut().append_pair(&parameter, &solved);
    }
    if let Some(n) = throttle_challenge(&url) {
        let solved = solutions.n.get(&n)?;
        let pairs: Vec<_> = url.query_pairs().into_owned().collect();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(pairs.iter().map(|(key, value)| {
                (
                    key.as_str(),
                    if key == "n" { solved } else { value }.as_str(),
                )
            }));
    }
    media_origin(&url).then_some(url)
}

/// `(video codec, audio codec)` from `video/mp4; codecs="avc1.x, mp4a.y"`.
fn codecs(mime_type: &str) -> (Option<&str>, Option<&str>) {
    let codecs = mime_type
        .split_once("codecs=\"")
        .and_then(|(_, tail)| tail.split_once('"'))
        .map_or("", |(codecs, _)| codecs);
    let find = |families: &[&str]| {
        codecs.split(',').map(str::trim).find(|codec| {
            let family = codec.split('.').next().unwrap_or_default();
            families
                .iter()
                .any(|known| family.eq_ignore_ascii_case(known))
        })
    };
    (
        find(&[
            "avc1", "avc2", "avc3", "avc4", "vp09", "vp9", "vp8", "hev1", "hev2", "h263", "h264",
            "mp4v", "hvc1", "av01", "av1", "theora", "dvh1", "dvhe",
        ]),
        find(&[
            "flac", "mp4a", "opus", "vorbis", "mp3", "aac", "ac-4", "ac-3", "ec-3", "eac3", "dtsc",
            "dtse", "dtsh", "dtsl",
        ]),
    )
}

fn quality_rank(quality: &str) -> i32 {
    [
        "tiny",
        "audio_quality_ultralow",
        "audio_quality_low",
        "audio_quality_medium",
        "audio_quality_high",
        "small",
        "medium",
        "large",
        "hd720",
        "hd1080",
        "hd1440",
        "hd2160",
        "hd2880",
        "highres",
    ]
    .iter()
    .position(|known| *known == quality)
    .map_or(-1, |index| index as i32)
}

fn language_preference(track: Option<&AudioTrack>) -> i32 {
    let Some(track) = track else { return -1 };
    let name = track.display_name.to_lowercase();
    if name.contains("descriptive") {
        -10
    } else if name.contains("original") {
        10
    } else if track.audio_is_default {
        5
    } else {
        -1
    }
}

/// `process_format_stream`
fn describe(stream: &Stream, url: Url, available_at: u64, duration: Option<u64>) -> Format {
    let mut quality = stream.quality.clone().unwrap_or_default();
    if quality.is_empty() || quality == "tiny" {
        if let Some(audio) = stream.audio_quality.as_ref().filter(|q| !q.is_empty()) {
            quality = audio.to_lowercase();
        }
    }
    if stream.itag == Some(17) {
        quality = "tiny".into();
    }
    let name = stream
        .quality_label
        .clone()
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| quality.replace("audio_quality_", ""));
    let format_duration = stream
        .approx_duration_ms
        .as_deref()
        .and_then(|ms| ms.parse::<f64>().ok())
        .map(|ms| ms / 1000.0);
    // Some formats are much shorter than the video, probably damaged encodes.
    let damaged = format_duration
        .zip(duration)
        .is_some_and(|(format, video)| format < (video / 2) as f64);
    let (video_codec, audio_codec) = codecs(&stream.mime_type);
    let has_video = video_codec.is_some();
    let has_audio = audio_codec.is_some();
    let (width, height) = (stream.width.unwrap_or(0), stream.height.unwrap_or(0));
    let video_fits = video_codec.is_some_and(|codec| codec.starts_with("avc1"))
        && stream.mime_type.starts_with("video/mp4;")
        && width > 0
        && height > 0
        && width.min(height) <= 1080
        && width.max(height) <= 1920;
    let audio_fits = audio_codec.is_some_and(|codec| codec.starts_with("mp4a"));
    let compatible = match (has_video, has_audio) {
        (true, true) => video_fits && audio_fits,
        (true, false) => video_fits,
        (false, true) => audio_fits && stream.mime_type.starts_with("audio/mp4;"),
        (false, false) => false,
    };
    let file_size = stream
        .content_length
        .as_deref()
        .and_then(|length| length.parse::<u64>().ok())
        .filter(|length| *length > 0);
    let bitrate = stream
        .average_bitrate
        .filter(|rate| *rate > 0)
        .or(stream.bitrate)
        .filter(|rate| *rate > 0);
    let estimated_size = bitrate
        .zip(format_duration)
        .map(|(rate, seconds)| (seconds * rate as f64 / 8.0) as u64)
        .filter(|size| *size > 0);
    let super_resolution = url.query_pairs().any(|(key, value)| {
        key == "xtags"
            && url::form_urlencoded::parse(value.as_bytes())
                .any(|(key, value)| key == "sr" && value == "1")
    });
    let mut id = stream.itag.map(|itag| itag.to_string()).unwrap_or_default();
    if stream.is_drc {
        id.push_str("-drc");
    } else if super_resolution {
        id.push_str("-sr");
    }
    Format {
        url,
        file_size,
        available_at,
        has_video,
        has_audio,
        compatible,
        preference: if damaged {
            -10
        } else if stream.itag == Some(17) {
            -2
        } else {
            -1
        },
        quality: f64::from(quality_rank(&quality)) - if stream.is_drc { 0.5 } else { 0.0 },
        res: [height, width]
            .into_iter()
            .filter(|side| *side > 0)
            .min()
            .unwrap_or(0),
        fps: stream.fps.filter(|fps| *fps > 1),
        source_preference: if stream.itag == Some(22) { -5 } else { -1 }
            + if name.contains("Premium") { 100 } else { 0 },
        channels: stream.audio_channels,
        language_preference: language_preference(stream.audio_track.as_ref()),
        size: file_size.or(estimated_size),
        bitrate,
        sample_rate: stream
            .audio_sample_rate
            .as_deref()
            .and_then(|rate| rate.parse().ok()),
        id,
    }
}

/// All usable HTTPS formats. For a stream offered by several clients the first
/// one wins.
pub(super) fn process(
    responses: &[PlayerResponse],
    solutions: &Solutions,
    has_player: bool,
    duration: Option<u64>,
) -> Vec<Format> {
    let mut seen = HashSet::new();
    let mut formats = Vec::new();
    for response in responses {
        let Some(client) = response.client else {
            continue;
        };
        for stream in streams(response) {
            if stream.drm_families.as_ref().is_some_and(truthy)
                || stream.target_duration_sec.as_ref().is_some_and(truthy)
                || stream.stream_type.as_deref() == Some("FORMAT_STREAM_TYPE_OTF")
            {
                continue;
            }
            let key = (
                stream.itag,
                stream
                    .audio_track
                    .as_ref()
                    .and_then(|track| track.id.clone()),
                stream.is_drc,
            );
            // Streams that need a PO token answer 403 without one. itag 18 does not.
            if client.requires_po_token && stream.itag != Some(18) {
                continue;
            }
            let Some(url) = solved_url(&stream, solutions, has_player) else {
                continue;
            };
            let format = describe(&stream, url, response.available_at, duration);
            if format.compatible && (stream.itag.is_none() || seen.insert(key)) {
                formats.push(format);
            }
        }
    }
    formats
}

/// yt-dlp's order for YouTube: preference, `quality`, `res`, `fps`, `source`,
/// `vcodec`, `channels`, `acodec`, `lang`, `size`, `br`, `asr`, id. The codec,
/// protocol and extension fields are equal within the compatible MP4 formats
/// except for having video or audio at all.
fn compare(a: &Format, b: &Format) -> Ordering {
    a.has_video
        .cmp(&b.has_video)
        .then_with(|| a.preference.cmp(&b.preference))
        .then_with(|| a.quality.total_cmp(&b.quality))
        .then_with(|| a.res.cmp(&b.res))
        .then_with(|| a.fps.cmp(&b.fps))
        .then_with(|| a.source_preference.cmp(&b.source_preference))
        .then_with(|| a.channels.cmp(&b.channels))
        .then_with(|| a.has_audio.cmp(&b.has_audio))
        .then_with(|| a.language_preference.cmp(&b.language_preference))
        .then_with(|| a.size.cmp(&b.size))
        .then_with(|| a.bitrate.cmp(&b.bitrate))
        .then_with(|| a.sample_rate.cmp(&b.sample_rate))
        .then_with(|| a.id.cmp(&b.id))
}

/// `bv*+ba/b` over the formats the editor can open.
pub(super) fn select(mut formats: Vec<Format>) -> Option<Selection> {
    formats.sort_by(compare);
    let best = formats.iter().rposition(|format| format.has_video)?;
    if !formats[best].has_audio {
        if let Some(audio) = formats
            .iter()
            .rposition(|format| format.has_audio && !format.has_video)
        {
            // Audio-only formats sort before every video format.
            let video = formats.remove(best);
            let audio = formats.remove(audio);
            return Some(Selection {
                video,
                audio: Some(audio),
            });
        }
    }
    let combined = formats
        .iter()
        .rposition(|format| format.has_video && format.has_audio)?;
    Some(Selection {
        video: formats.remove(combined),
        audio: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipper::youtube::clients;
    use serde_json::json;

    #[test]
    fn prefers_compatible_1080p_with_original_audio() {
        let media = "https://r1.googlevideo.com/a";
        let response = PlayerResponse {
            client: Some(&clients::VISIONOS),
            available_at: 0,
            data: json!({"streamingData": {
                "formats": [
                    {"itag": 18, "mimeType": "video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"", "quality": "medium", "width": 640, "height": 360, "url": media},
                ],
                "adaptiveFormats": [
                    {"itag": 137, "mimeType": "video/mp4; codecs=\"avc1.640028\"", "quality": "hd1080", "width": 1080, "height": 1920, "url": media},
                    {"itag": 313, "mimeType": "video/mp4; codecs=\"avc1.640033\"", "quality": "hd2160", "width": 3840, "height": 2160, "url": media},
                    {"itag": 399, "mimeType": "video/mp4; codecs=\"av01.0.08M.08\"", "quality": "hd1080", "width": 1920, "height": 1080, "url": media},
                    {"itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"", "audioQuality": "AUDIO_QUALITY_MEDIUM", "bitrate": 9999, "audioTrack": {"id": "pl.1", "displayName": "Polish", "audioIsDefault": true}, "url": media},
                    {"itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"", "audioQuality": "AUDIO_QUALITY_MEDIUM", "bitrate": 1000, "audioTrack": {"id": "en.4", "displayName": "English original"}, "url": media},
                ],
            }}),
        };
        let selection = select(process(&[response], &Solutions::default(), false, None)).unwrap();
        assert_eq!(selection.video.id, "137");
        assert_eq!(selection.audio.unwrap().bitrate, Some(1000));
    }
}
