//! Port of yt-dlp `extractor/youtube/_base.py` (`INNERTUBE_CLIENTS`, API headers,
//! consent cookies) and of the default request headers in `utils/networking.py`.

use super::{cancellable, check_cancel, network_error, ImportError, PLAYER_RESPONSE};
use reqwest::{
    cookie::Jar,
    header::{self, HeaderMap, HeaderValue},
    Client, RequestBuilder, Response, StatusCode, Url,
};
use serde_json::{json, Value};
use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

const MAX_PAGE: usize = 12 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(20);
const HEADER_TIMEOUT: Duration = Duration::from_secs(35);
/// yt-dlp `--extractor-retries`.
const RETRIES: u32 = 3;
pub(super) const ORIGIN: &str = "https://www.youtube.com";

pub(super) struct ClientDef {
    pub key: &'static str,
    pub name_id: u32,
    /// `REQUIRE_JS_PLAYER`
    pub require_js_player: bool,
    /// `GVS_PO_TOKEN_POLICY[https].required`. We never have a PO token.
    pub requires_po_token: bool,
    pub embedded: bool,
    /// `INNERTUBE_CONTEXT`
    context: fn() -> Value,
}

pub(super) static TV_SAMSUNG: ClientDef = ClientDef {
    key: "tv_samsung",
    name_id: 7,
    require_js_player: true,
    requires_po_token: false,
    embedded: false,
    context: || {
        json!({"client": {
            "clientName": "TVHTML5",
            "clientVersion": "5.20260707",
            "deviceMake": "Samsung",
            "deviceModel": "UKS9800",
            "userAgent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1",
            "osName": "Tizen",
            "osVersion": "2.4.0",
        }})
    },
};

pub(super) static VISIONOS: ClientDef = ClientDef {
    key: "visionos",
    name_id: 101,
    require_js_player: false,
    requires_po_token: false,
    embedded: false,
    context: || {
        json!({"client": {
            "clientName": "VISIONOS",
            "clientVersion": "1.02",
            "deviceMake": "Apple",
            "deviceModel": "RealityDevice17,1",
            "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            "osName": "visionOS",
            "osVersion": "26.5.23O471",
        }})
    },
};

pub(super) static IOS_PRODUCER: ClientDef = ClientDef {
    key: "ios_producer",
    name_id: 92,
    require_js_player: false,
    requires_po_token: false,
    embedded: false,
    context: || {
        json!({"client": {
            "clientName": "IOS_PRODUCER",
            "clientVersion": "0.147.945",
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "userAgent": "com.google.ios.youtubeproducer/0.147.945 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            "osName": "iPhone",
            "osVersion": "18.3.2.22D82",
        }})
    },
};

pub(super) static WEB_EMBEDDED: ClientDef = ClientDef {
    key: "web_embedded",
    name_id: 56,
    require_js_player: true,
    requires_po_token: true,
    embedded: true,
    context: || {
        let mut context = json!({"client": {
            "clientName": "WEB_EMBEDDED_PLAYER",
            "clientVersion": "2.20260708.00.00",
            "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
        }});
        fix_embedded_context(&mut context);
        context
    },
};

/// `_fix_embedded_ytcfg`: the embed URL can be any valid non-YouTube URL.
pub(super) fn fix_embedded_context(context: &mut Value) {
    if let Some(context) = context.as_object_mut() {
        let third_party = context.entry("thirdParty").or_insert_with(|| json!({}));
        if let Some(third_party) = third_party.as_object_mut() {
            third_party.insert("embedUrl".into(), json!("https://www.reddit.com/"));
        }
    }
}

impl ClientDef {
    pub(super) fn default_context(&self) -> Value {
        (self.context)()
    }

    pub(super) fn default_user_agent(&self) -> Option<String> {
        text(&self.default_context(), "/client/userAgent")
    }

    /// `_extract_context`: the downloaded ytcfg wins over the built-in defaults.
    pub(super) fn api_context(&self, ytcfg: &Value) -> Value {
        let mut context = ytcfg
            .get("INNERTUBE_CONTEXT")
            .filter(|context| context.get("client").is_some_and(Value::is_object))
            .cloned()
            .unwrap_or_else(|| self.default_context());
        if let Some(client) = context.get_mut("client").and_then(Value::as_object_mut) {
            client.insert("hl".into(), json!("en"));
            client.insert("timeZone".into(), json!("UTC"));
            client.insert("utcOffsetMinutes".into(), json!(0));
        }
        context
    }

    /// `generate_api_headers` for a signed-out session.
    pub(super) fn api_headers(&self, ytcfg: &Value, visitor_data: Option<&str>) -> HeaderMap {
        let defaults = self.default_context();
        let name = ytcfg
            .get("INNERTUBE_CONTEXT_CLIENT_NAME")
            .and_then(Value::as_u64)
            .unwrap_or(u64::from(self.name_id));
        let version = text(ytcfg, "/INNERTUBE_CLIENT_VERSION")
            .or_else(|| text(ytcfg, "/INNERTUBE_CONTEXT/client/clientVersion"))
            .or_else(|| text(&defaults, "/client/clientVersion"));
        let user_agent = text(ytcfg, "/INNERTUBE_CONTEXT/client/userAgent")
            .or_else(|| text(&defaults, "/client/userAgent"));
        let mut headers = HeaderMap::new();
        for (key, value) in [
            ("x-youtube-client-name", Some(name.to_string())),
            ("x-youtube-client-version", version),
            ("origin", Some(ORIGIN.to_owned())),
            ("x-goog-visitor-id", visitor_data.map(str::to_owned)),
            ("user-agent", user_agent),
            ("content-type", Some("application/json".to_owned())),
        ] {
            if let Some(value) = value.and_then(|value| HeaderValue::from_str(&value).ok()) {
                headers.insert(key, value);
            }
        }
        headers
    }
}

fn text(value: &Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_owned)
}

pub(super) struct Session {
    pub http: Client,
}

impl Session {
    pub(super) fn new() -> Result<Self, ImportError> {
        // yt-dlp `random_user_agent`: a recent desktop Chrome.
        let chrome = 151 + (uuid::Uuid::new_v4().as_u128() % 7) as u32;
        let user_agent = format!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Safari/537.36"
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ),
        );
        headers.insert(
            header::ACCEPT_LANGUAGE,
            HeaderValue::from_static("en-us,en;q=0.5"),
        );
        headers.insert("sec-fetch-mode", HeaderValue::from_static("navigate"));
        // `_initialize_pref` and `_initialize_consent`.
        let cookies = Arc::new(Jar::default());
        let url = Url::parse(ORIGIN).map_err(|_| network_error("resolve"))?;
        for cookie in ["PREF=hl=en&tz=UTC", "SOCS=CAI"] {
            cookies.add_cookie_str(&format!("{cookie}; Domain=.youtube.com; Secure"), &url);
        }
        let http = Client::builder()
            // yt-dlp speaks HTTP/1.1. Over HTTP/2, YouTube pages are
            // intermittently reset with a protocol error.
            .http1_only()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(IO_TIMEOUT)
            .read_timeout(IO_TIMEOUT)
            .user_agent(user_agent)
            .default_headers(headers)
            .cookie_provider(cookies)
            .build()
            .map_err(|_| network_error("resolve"))?;
        Ok(Self { http })
    }
}

pub(super) fn youtube_origin(url: &Url) -> bool {
    safe_https(url) && url.host_str() == Some("www.youtube.com")
}

pub(super) fn media_origin(url: &Url) -> bool {
    safe_https(url)
        && url
            .host_str()
            .is_some_and(|host| host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
}

fn safe_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub(super) enum SendError {
    Cancelled(ImportError),
    Transport,
}

/// Sends a request and follows redirects, confining every hop to `origin`.
/// Any final HTTP status is returned to the caller.
pub(super) async fn send(
    mut url: Url,
    origin: fn(&Url) -> bool,
    build: impl Fn(Url) -> RequestBuilder,
    cancelled: &AtomicBool,
) -> Result<Response, SendError> {
    for _ in 0..=4 {
        check_cancel(cancelled).map_err(SendError::Cancelled)?;
        if !origin(&url) {
            return Err(SendError::Transport);
        }
        let response = cancellable(
            tokio::time::timeout(HEADER_TIMEOUT, build(url.clone()).send()),
            cancelled,
        )
        .await
        .map_err(SendError::Cancelled)?
        .map_err(|_| SendError::Transport)?
        .map_err(|_| SendError::Transport)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|header| header.to_str().ok())
                .ok_or(SendError::Transport)?;
            url = url.join(location).map_err(|_| SendError::Transport)?;
            continue;
        }
        return Ok(response);
    }
    Err(SendError::Transport)
}

pub(super) fn status_error(status: StatusCode, phase: &'static str) -> ImportError {
    match status.as_u16() {
        401 | 403 | 404 | 410 => ImportError::new(
            "youtube_http_denied",
            phase,
            "YouTube did not make this video available for import.",
        ),
        429 => ImportError::new(
            "youtube_rate_limit",
            phase,
            "YouTube is limiting requests. Try again later.",
        ),
        _ => network_error(phase),
    }
}

/// A bounded YouTube request with yt-dlp's retry rule: 403 and 429 are final.
pub(super) async fn fetch_text(
    url: Url,
    build: impl Fn(Url) -> RequestBuilder,
    phase: &'static str,
    cancelled: &AtomicBool,
) -> Result<String, ImportError> {
    let mut error = network_error(phase);
    'attempt: for _ in 0..=RETRIES {
        let mut response = match send(url.clone(), youtube_origin, &build, cancelled).await {
            Ok(response) => response,
            Err(SendError::Cancelled(cancel)) => return Err(cancel),
            Err(SendError::Transport) => continue,
        };
        let status = response.status();
        if !status.is_success() {
            error = status_error(status, phase);
            if matches!(status.as_u16(), 403 | 429) {
                break;
            }
            continue;
        }
        let mut bytes = Vec::new();
        loop {
            match cancellable(response.chunk(), cancelled).await? {
                Ok(Some(chunk)) => {
                    if bytes.len() + chunk.len() > MAX_PAGE {
                        return Err(PLAYER_RESPONSE);
                    }
                    bytes.extend(chunk);
                }
                Ok(None) => break,
                Err(_) => continue 'attempt,
            }
        }
        return String::from_utf8(bytes).map_err(|_| PLAYER_RESPONSE);
    }
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_urls_are_confined_to_google_video_over_https() {
        assert!(media_origin(
            &Url::parse("https://r1.googlevideo.com/videoplayback").unwrap()
        ));
        assert!(!media_origin(
            &Url::parse("https://googlevideo.com.example.org/video").unwrap()
        ));
        assert!(!media_origin(
            &Url::parse("http://r1.googlevideo.com/video").unwrap()
        ));
    }
}
