//! Port of yt-dlp's player script handling (`_video.py`: player URL and signature
//! timestamp) and of the EJS challenge solver (`jsc/_builtin/ejs.py`).

use super::{
    check_cancel,
    clients::{self, Session},
    ImportError, CANCELLED,
};
use reqwest::Url;
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

const LIB: &str = include_str!("../../../vendor/yt-dlp-ejs/yt.solver.lib.min.js");
const CORE: &str = include_str!("../../../vendor/yt-dlp-ejs/yt.solver.core.min.js");
/// `_DEFAULT_PLAYER_JS_VARIANT` is `tv`.
const PLAYER_PATH: &str = "tv-player-ias.vflset/tv-player-ias.js";
const JS_THREAD_STACK: usize = 32 * 1024 * 1024;
const JS_STACK: usize = 16 * 1024 * 1024;
const JS_MEMORY: usize = 512 * 1024 * 1024;
const JS_DEADLINE: Duration = Duration::from_secs(30);
const PLAYER_ERROR: ImportError = ImportError::new(
    "player_script_changed",
    "player",
    "Open Clipper could not read this YouTube stream. Try again or choose a video file.",
);

/// `_extract_player_info`
fn player_id(url: &str) -> Option<&str> {
    let (_, tail) = url.split_once("/s/player/")?;
    let (id, _) = tail.split_once('/')?;
    (id.len() >= 8 && id.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(id)
}

/// `_construct_player_url`: always the default variant of the given player.
fn construct_url(id: &str) -> Option<Url> {
    Url::parse(&format!("{}/s/player/{id}/{PLAYER_PATH}", clients::ORIGIN)).ok()
}

/// `_extract_player_url`
pub(super) fn url_from_ytcfgs(ytcfgs: &[&Value]) -> Option<Url> {
    let url = ytcfgs
        .iter()
        .find_map(|ytcfg| ytcfg.get("PLAYER_JS_URL")?.as_str())
        .or_else(|| {
            ytcfgs.iter().find_map(|ytcfg| {
                ytcfg
                    .get("WEB_PLAYER_CONTEXT_CONFIGS")?
                    .as_object()?
                    .values()
                    .find_map(|config| config.get("jsUrl")?.as_str())
            })
        })?;
    construct_url(player_id(url)?)
}

fn iframe_player_id(script: &str) -> Option<&str> {
    script.match_indices("player").find_map(|(index, marker)| {
        let tail = &script[index + marker.len()..];
        let tail = tail.strip_prefix('\\').unwrap_or(tail).strip_prefix('/')?;
        let id = tail.get(..8)?;
        let after = tail.get(8..)?;
        let after = after.strip_prefix('\\').unwrap_or(after);
        (id.bytes().all(|byte| byte.is_ascii_hexdigit()) && after.starts_with('/')).then_some(id)
    })
}

/// `_download_player_url`
pub(super) async fn download_url(
    session: &Session,
    cancelled: &AtomicBool,
) -> Result<Option<Url>, ImportError> {
    let Ok(url) = Url::parse(&format!("{}/iframe_api", clients::ORIGIN)) else {
        return Ok(None);
    };
    match clients::fetch_text(url, |url| session.http.get(url), "player", cancelled).await {
        Ok(script) => Ok(iframe_player_id(&script).and_then(construct_url)),
        Err(error) if error.code == CANCELLED.code => Err(error),
        Err(error) => {
            log::warn!("youtube import: iframe API failed: {}", error.code);
            Ok(None)
        }
    }
}

/// The first `signatureTimestamp:12345` or `sts:12345` in the player script.
fn script_timestamp(script: &str) -> Option<u64> {
    ["signatureTimestamp", "sts"]
        .into_iter()
        .filter_map(|marker| {
            script.match_indices(marker).find_map(|(index, _)| {
                let digits = script[index + marker.len()..]
                    .trim_start()
                    .strip_prefix(':')?
                    .trim_start()
                    .get(..5)?;
                if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }
                Some((index, digits.parse::<u64>().ok()?))
            })
        })
        .min_by_key(|(index, _)| *index)
        .map(|(_, value)| value)
}

#[derive(Default)]
pub(super) struct Challenges {
    pub n: BTreeSet<String>,
    /// Signatures are solved once per length, see `Solutions::signature`.
    pub signature_lengths: BTreeSet<usize>,
}

#[derive(Default)]
pub(super) struct Solutions {
    pub n: HashMap<String, String>,
    /// For each signature length, which input character goes to each position.
    pub signature: HashMap<usize, Vec<usize>>,
}

#[derive(Default)]
pub(super) struct Player {
    scripts: HashMap<Url, String>,
}

impl Player {
    /// `_load_player`, non-fatal.
    async fn load(
        &mut self,
        session: &Session,
        url: &Url,
        cancelled: &AtomicBool,
    ) -> Result<Option<&str>, ImportError> {
        if !self.scripts.contains_key(url) {
            match clients::fetch_text(
                url.clone(),
                |url| session.http.get(url),
                "player",
                cancelled,
            )
            .await
            {
                Ok(script) => {
                    self.scripts.insert(url.clone(), script);
                }
                Err(error) if error.code == CANCELLED.code => return Err(error),
                Err(error) => log::warn!("youtube import: player script failed: {}", error.code),
            }
        }
        Ok(self.scripts.get(url).map(String::as_str))
    }

    /// `_extract_signature_timestamp`
    pub(super) async fn signature_timestamp(
        &mut self,
        session: &Session,
        url: &Url,
        ytcfg: &Value,
        cancelled: &AtomicBool,
    ) -> Result<Option<u64>, ImportError> {
        let configured = ytcfg
            .get("STS")
            .and_then(|sts| sts.as_u64().or_else(|| sts.as_str()?.parse().ok()))
            .filter(|sts| *sts > 0);
        if let Some(sts) = configured {
            // yt-dlp's temporary workaround: only the first five digits are used.
            let digits = sts.to_string();
            return Ok(digits[..digits.len().min(5)].parse().ok());
        }
        Ok(self
            .load(session, url, cancelled)
            .await?
            .and_then(script_timestamp))
    }

    /// Solves every challenge in one run. A failure only costs the formats that
    /// needed the solution.
    pub(super) async fn solve(
        &mut self,
        session: &Session,
        url: &Url,
        challenges: &Challenges,
        cancelled: &AtomicBool,
    ) -> Result<Solutions, ImportError> {
        let mut requests = Vec::new();
        if !challenges.n.is_empty() {
            requests.push(json!({"type": "n", "challenges": challenges.n}));
        }
        if !challenges.signature_lengths.is_empty() {
            // Each challenge is the characters 0..length, so the answer reveals
            // the permutation.
            let inputs: Vec<String> = challenges
                .signature_lengths
                .iter()
                .map(|length| (0..*length as u32).filter_map(char::from_u32).collect())
                .collect();
            requests.push(json!({"type": "sig", "challenges": inputs}));
        }
        if requests.is_empty() {
            return Ok(Solutions::default());
        }
        let Some(script) = self.load(session, url, cancelled).await? else {
            return Ok(Solutions::default());
        };
        let input = json!({"type": "player", "player": script, "requests": &requests}).to_string();
        let result = tokio::task::block_in_place(|| evaluate(input, cancelled));
        match result {
            Ok(result) => Ok(read_solutions(&requests, &result)),
            Err(error) if error.code == CANCELLED.code => Err(error),
            Err(error) => {
                log::warn!("youtube import: challenge solver failed: {}", error.code);
                Ok(Solutions::default())
            }
        }
    }
}

fn read_solutions(requests: &[Value], result: &Value) -> Solutions {
    let mut solutions = Solutions::default();
    let Some(responses) = result.get("responses").and_then(Value::as_array) else {
        log::warn!("youtube import: challenge solver returned no responses");
        return solutions;
    };
    for (request, response) in requests.iter().zip(responses) {
        let Some(data) = response.get("data").and_then(Value::as_object) else {
            log::warn!(
                "youtube import: {} challenge solving failed",
                request["type"]
            );
            continue;
        };
        for (challenge, answer) in data {
            let Some(answer) = answer
                .as_str()
                .filter(|answer| !answer.is_empty() && answer.len() <= 1024)
            else {
                continue;
            };
            if request["type"] == "n" {
                solutions.n.insert(challenge.clone(), answer.to_owned());
            } else {
                solutions.signature.insert(
                    challenge.chars().count(),
                    answer.chars().map(|c| c as usize).collect(),
                );
            }
        }
    }
    solutions
}

fn evaluate(input: String, cancelled: &AtomicBool) -> Result<Value, ImportError> {
    check_cancel(cancelled)?;
    // The player script nests deeply, so QuickJS gets its own large stack.
    let result = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("youtube-player".into())
            .stack_size(JS_THREAD_STACK)
            .spawn_scoped(scope, move || run_solver(input))
            .map_err(|_| PLAYER_ERROR)?
            .join()
            .map_err(|_| PLAYER_ERROR)?
    });
    check_cancel(cancelled)?;
    serde_json::from_str(&result?).map_err(|_| PLAYER_ERROR)
}

fn run_solver(input: String) -> Result<String, ImportError> {
    let runtime = rquickjs::Runtime::new().map_err(|_| PLAYER_ERROR)?;
    runtime.set_memory_limit(JS_MEMORY);
    runtime.set_max_stack_size(JS_STACK);
    let deadline = Instant::now() + JS_DEADLINE;
    // The callback must own its state. Keep the watchdog scoped to this runtime.
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = rquickjs::Context::full(&runtime).map_err(|_| PLAYER_ERROR)?;
    let result = context.with(|ctx| -> rquickjs::Result<String> {
        ctx.eval::<(), _>(LIB)?;
        ctx.eval::<(), _>("Object.assign(globalThis, lib); void 0;")?;
        ctx.eval::<(), _>(CORE)?;
        ctx.globals().set("openClipperInput", input)?;
        ctx.eval("JSON.stringify(jsc(JSON.parse(openClipperInput)))")
    });
    result.map_err(|_| PLAYER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_ejs_runs_in_the_embedded_runtime() {
        let input = json!({
            "type": "preprocessed",
            "preprocessed_player": "_result.sig = (value) => value.split('').reverse().join('');",
            "requests": [{"type": "sig", "challenges": ["abc"]}],
        });
        let output = evaluate(input.to_string(), &AtomicBool::new(false)).unwrap();
        assert_eq!(output["responses"][0]["data"]["abc"], "cba");
    }

    #[test]
    fn only_accepts_the_canonical_player_script_origin() {
        let ytcfg = json!({
            "PLAYER_JS_URL": "https://example.org/s/player/0123abcd/player_ias.vflset/en_US/base.js",
        });
        let url = url_from_ytcfgs(&[&ytcfg]).unwrap();
        assert_eq!(url.host_str(), Some("www.youtube.com"));
        assert_eq!(url.path(), format!("/s/player/0123abcd/{PLAYER_PATH}"));
    }
}
