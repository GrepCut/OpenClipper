//! Port of yt-dlp `extractor/youtube/_video.py`: the watch page, the player API
//! requests and the client fallbacks (`_extract_player_responses`).

use super::{
    check_cancel,
    clients::{self, ClientDef, Session},
    player::{self, Player},
    unix_now, ImportError, CANCELLED, PLAYER_RESPONSE,
};
use reqwest::{header, Url};
use serde_json::{json, Map, Value};
use std::sync::atomic::AtomicBool;

pub(super) struct PlayerResponse {
    /// `None` for the response embedded in the watch page, which only supplies
    /// video details and playability (its streams are never used).
    pub client: Option<&'static ClientDef>,
    pub data: Value,
    /// Unix time before which the media must not be requested (pre-roll ads).
    pub available_at: u64,
}

pub(super) struct Extraction {
    pub responses: Vec<PlayerResponse>,
    pub player_url: Option<Url>,
    /// The last failed API request, reported when no client answered.
    pub error: Option<ImportError>,
}

/// The first JSON object that follows `marker` and the `separator` character.
fn object_after(page: &str, marker: &str, separator: char) -> Option<(Value, usize)> {
    page.match_indices(marker).find_map(|(index, _)| {
        let tail = page[index + marker.len()..]
            .trim_start()
            .strip_prefix(separator)?
            .trim_start();
        if !tail.starts_with('{') {
            return None;
        }
        let mut stream = serde_json::Deserializer::from_str(tail).into_iter::<Value>();
        let value = stream.next()?.ok()?;
        Some((value, page.len() - tail.len() + stream.byte_offset()))
    })
}

/// `extract_ytcfg`: the first `ytcfg.set({...});`.
fn extract_ytcfg(page: &str) -> Value {
    let mut rest = page;
    while let Some((value, end)) = object_after(rest, "ytcfg.set", '(') {
        rest = &rest[end..];
        if rest
            .trim_start()
            .strip_prefix(')')
            .is_some_and(|tail| tail.trim_start().starts_with(';'))
        {
            return value;
        }
    }
    Value::Object(Map::new())
}

fn initial_player_response(page: &str) -> Option<Value> {
    object_after(page, "ytInitialPlayerResponse", '=').map(|(value, _)| value)
}

/// `_extract_visitor_data`
fn visitor_data(sources: &[&Value]) -> Option<String> {
    sources.iter().find_map(|source| {
        [
            "/VISITOR_DATA",
            "/INNERTUBE_CONTEXT/client/visitorData",
            "/responseContext/visitorData",
        ]
        .iter()
        .find_map(|pointer| source.pointer(pointer).and_then(Value::as_str))
        .map(str::to_owned)
    })
}

/// `_invalid_player_response`: YouTube may answer for a different video. A
/// response without video details (an error status) is kept for its reason.
fn for_another_video(response: &Value, id: &str) -> bool {
    response
        .pointer("/videoDetails/videoId")
        .and_then(Value::as_str)
        .is_some_and(|other| !other.is_empty() && other != id)
}

pub(super) fn playability(response: &Value) -> Option<&str> {
    response
        .pointer("/playabilityStatus/status")
        .and_then(Value::as_str)
}

/// `_is_agegated` (case sensitive, as in yt-dlp).
pub(super) fn is_agegated(response: &Value) -> bool {
    if response
        .pointer("/playabilityStatus/desktopLegacyAgeGateReason")
        .is_some_and(truthy)
    {
        return true;
    }
    let reasons = [
        playability(response),
        response
            .pointer("/playabilityStatus/reason")
            .and_then(Value::as_str),
    ];
    reasons.iter().flatten().any(|reason| {
        [
            "confirm your age",
            "age-restricted",
            "inappropriate",
            "age_verification_required",
            "age_check_required",
        ]
        .iter()
        .any(|expected| reason.contains(expected))
    })
}

pub(super) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn items<'a>(value: &'a Value, pointer: &str) -> impl Iterator<Item = &'a Value> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

/// `_get_available_at_timestamp`
fn available_at(response: &Value) -> u64 {
    let mut renderers = Vec::new();
    for placement in items(response, "/adPlacements") {
        let kind = placement
            .pointer("/adPlacementRenderer/config/adPlacementConfig/kind")
            .and_then(Value::as_str);
        if kind == Some("AD_PLACEMENT_KIND_START") {
            renderers
                .extend(placement.pointer("/adPlacementRenderer/renderer/instreamVideoAdRenderer"));
        }
    }
    for slot in items(response, "/adSlots") {
        let trigger = slot
            .pointer("/adSlotRenderer/adSlotMetadata/triggerEvent")
            .and_then(Value::as_str);
        if trigger != Some("SLOT_TRIGGER_EVENT_BEFORE_CONTENT") {
            continue;
        }
        let Some(content) = slot.pointer(
            "/adSlotRenderer/fulfillmentContent/fulfilledLayout/playerBytesAdLayoutRenderer/renderingContent",
        ) else {
            continue;
        };
        renderers.extend(content.get("instreamVideoAdRenderer"));
        renderers.extend(
            items(
                content,
                "/playerBytesSequentialLayoutRenderer/sequentialLayouts",
            )
            .filter_map(|layout| {
                layout.pointer(
                    "/playerBytesAdLayoutRenderer/renderingContent/instreamVideoAdRenderer",
                )
            }),
        );
    }
    let mut wait = 0.0;
    for renderer in renderers {
        let duration = renderer
            .get("playerVars")
            .and_then(Value::as_str)
            .and_then(|vars| {
                url::form_urlencoded::parse(vars.as_bytes())
                    .filter(|(key, _)| key == "length_seconds")
                    .last()
                    .and_then(|(_, value)| value.parse::<f64>().ok())
            });
        // A skippable ad only has to be waited out until it can be skipped.
        let skip = renderer.get("skipOffsetMilliseconds").and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str()?.parse().ok())
                .map(|milliseconds: f64| milliseconds / 1000.0)
        });
        wait += skip.or(duration).unwrap_or_default();
    }
    if wait > 0.0 {
        (unix_now().as_secs_f64().ceil() + wait).ceil() as u64
    } else {
        unix_now().as_secs()
    }
}

/// `_download_ytcfg`. Of the clients used here only `web_embedded` has a page.
async fn download_ytcfg(
    session: &Session,
    client: &ClientDef,
    id: &str,
    cancelled: &AtomicBool,
) -> Result<Option<Value>, ImportError> {
    if !client.embedded {
        return Ok(None);
    }
    let url = Url::parse(&format!("{}/embed/{id}?html5=1", clients::ORIGIN))
        .map_err(|_| PLAYER_RESPONSE)?;
    let user_agent = client.default_user_agent();
    let referer = client
        .default_context()
        .pointer("/thirdParty/embedUrl")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let page = clients::fetch_text(
        url,
        |url| {
            let mut request = session.http.get(url);
            if let Some(user_agent) = &user_agent {
                request = request.header(header::USER_AGENT, user_agent);
            }
            if let Some(referer) = &referer {
                request = request.header(header::REFERER, referer);
            }
            request
        },
        "resolve",
        cancelled,
    )
    .await;
    let page = match page {
        Ok(page) => page,
        Err(error) if error.code == CANCELLED.code => return Err(error),
        Err(error) => {
            log::warn!(
                "youtube import: {} config failed: {}",
                client.key,
                error.code
            );
            return Ok(None);
        }
    };
    let mut ytcfg = extract_ytcfg(&page);
    if let Some(context) = ytcfg.get_mut("INNERTUBE_CONTEXT") {
        clients::fix_embedded_context(context);
    }
    Ok(ytcfg
        .as_object()
        .is_some_and(|ytcfg| !ytcfg.is_empty())
        .then_some(ytcfg))
}

/// `_extract_player_response` and `_generate_player_context`
async fn request_player(
    session: &Session,
    client: &ClientDef,
    id: &str,
    ytcfg: &Value,
    visitor_data: Option<&str>,
    signature_timestamp: Option<u64>,
    cancelled: &AtomicBool,
) -> Result<Value, ImportError> {
    let mut playback = json!({"html5Preference": "HTML5_PREF_WANTS"});
    if let Some(timestamp) = signature_timestamp {
        playback["signatureTimestamp"] = json!(timestamp);
    }
    if client.embedded {
        if let Some(flags) = ytcfg.pointer(
            "/WEB_PLAYER_CONTEXT_CONFIGS/WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER/encryptedHostFlags",
        ) {
            playback["encryptedHostFlags"] = flags.clone();
        }
    }
    let body = json!({
        "context": client.api_context(ytcfg),
        "videoId": id,
        "playbackContext": {"contentPlaybackContext": playback},
        "contentCheckOk": true,
        "racyCheckOk": true,
    })
    .to_string();
    let url = Url::parse(&format!(
        "{}/youtubei/v1/player?prettyPrint=false",
        clients::ORIGIN
    ))
    .map_err(|_| PLAYER_RESPONSE)?;
    let headers = client.api_headers(ytcfg, visitor_data);
    let text = clients::fetch_text(
        url,
        |url| {
            session
                .http
                .post(url)
                .headers(headers.clone())
                .body(body.clone())
        },
        "resolve",
        cancelled,
    )
    .await?;
    serde_json::from_str(&text).map_err(|_| PLAYER_RESPONSE)
}

pub(super) async fn extract(
    session: &Session,
    player: &mut Player,
    id: &str,
    cancelled: &AtomicBool,
) -> Result<Extraction, ImportError> {
    let watch = Url::parse_with_params(
        &format!("{}/watch", clients::ORIGIN),
        &[("v", id), ("bpctr", "9999999999"), ("has_verified", "1")],
    )
    .map_err(|_| PLAYER_RESPONSE)?;
    let mut error = None;
    let page = clients::fetch_text(watch, |url| session.http.get(url), "resolve", cancelled).await;
    // As in yt-dlp, a failed watch page does not stop the API requests.
    let page = match page {
        Ok(page) => page,
        Err(failure) if failure.code == CANCELLED.code => return Err(failure),
        Err(failure) => {
            log::warn!("youtube import: watch page failed: {}", failure.code);
            error = Some(failure);
            String::new()
        }
    };
    let webpage_ytcfg = extract_ytcfg(&page);
    let initial = initial_player_response(&page);

    let mut responses = Vec::new();
    if let Some(initial) = initial.as_ref().filter(|pr| !for_another_video(pr, id)) {
        let mut data = initial.clone();
        if let Some(data) = data.as_object_mut() {
            data.remove("streamingData");
        }
        responses.push(PlayerResponse {
            client: None,
            data,
            available_at: 0,
        });
    }

    // A stack, as in yt-dlp: fallback clients are tried right after the response
    // that asked for them, the last appended first.
    let mut queue: Vec<&'static ClientDef> = vec![&clients::VISIONOS, &clients::TV_SAMSUNG];
    let mut known: Vec<&'static str> = queue.iter().map(|client| client.key).collect();
    let mut tried_iframe = false;
    let mut player_url = None;
    let mut visitor = None;
    while let Some(client) = queue.pop() {
        check_cancel(cancelled)?;
        let downloaded = download_ytcfg(session, client, id, cancelled).await?;
        let player_ytcfg = downloaded.unwrap_or_else(|| Value::Object(Map::new()));

        player_url =
            player_url.or_else(|| player::url_from_ytcfgs(&[&webpage_ytcfg, &player_ytcfg]));
        if player_url.is_none() && !tried_iframe && client.require_js_player {
            player_url = player::download_url(session, cancelled).await?;
            tried_iframe = true;
        }
        visitor = visitor.or_else(|| {
            let mut sources = vec![&webpage_ytcfg];
            sources.extend(initial.as_ref());
            sources.push(&player_ytcfg);
            visitor_data(&sources)
        });
        let signature_timestamp = match &player_url {
            Some(url) => {
                let ytcfg = if player_ytcfg.as_object().is_some_and(|map| !map.is_empty()) {
                    &player_ytcfg
                } else {
                    &webpage_ytcfg
                };
                player
                    .signature_timestamp(session, url, ytcfg, cancelled)
                    .await?
            }
            None => None,
        };

        let data = match request_player(
            session,
            client,
            id,
            &player_ytcfg,
            visitor.as_deref(),
            signature_timestamp,
            cancelled,
        )
        .await
        {
            Ok(data) => data,
            Err(failure) if failure.code == CANCELLED.code => return Err(failure),
            Err(failure) => {
                log::warn!("youtube import: {} failed: {}", client.key, failure.code);
                error = Some(failure);
                continue;
            }
        };

        let status = playability(&data);
        if status != Some("OK") {
            log::warn!(
                "youtube import: {} playability status: {}",
                client.key,
                status.unwrap_or("missing")
            );
        }
        let made_for_kids = client.key == clients::VISIONOS.key
            && matches!(status, Some("UNPLAYABLE" | "ERROR"))
            && page.contains("made for kids");
        let age_gated = is_agegated(&data);

        if for_another_video(&data, id) {
            log::warn!(
                "youtube import: {} answered for a different video",
                client.key
            );
            error = Some(PLAYER_RESPONSE);
        } else {
            let available_at = available_at(&data);
            responses.push(PlayerResponse {
                client: Some(client),
                data,
                available_at,
            });
        }

        let mut append = |client: &'static ClientDef| {
            if !known.contains(&client.key) {
                known.push(client.key);
                queue.push(client);
            }
        };
        if made_for_kids {
            append(&clients::WEB_EMBEDDED);
            append(&clients::IOS_PRODUCER);
        }
        if age_gated {
            append(&clients::WEB_EMBEDDED);
        }
    }

    Ok(Extraction {
        responses,
        player_url,
        error,
    })
}
