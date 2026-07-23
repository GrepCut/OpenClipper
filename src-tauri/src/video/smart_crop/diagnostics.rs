use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const FILE_NAME: &str = "open-clipper-face-action.log";

struct DiagnosticState {
    file: File,
    started: Instant,
}

static STATE: OnceLock<Mutex<Option<DiagnosticState>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<DiagnosticState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

pub fn path() -> PathBuf {
    dirs::download_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(std::env::temp_dir)
        .join(FILE_NAME)
}

pub fn start(source: &str, start_time: f64, end_time: f64, tracking_enabled: bool) {
    let path = path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let opened = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path);
    let Ok(file) = opened else {
        return;
    };
    if let Ok(mut guard) = state().lock() {
        *guard = Some(DiagnosticState {
            file,
            started: Instant::now(),
        });
    }
    append(
        "run",
        &format!(
            "START version={} pid={} source={} range={start_time:.3}..{end_time:.3} tracking={} log={}",
            env!("CARGO_PKG_VERSION"),
            std::process::id(),
            source,
            tracking_enabled,
            path.display()
        ),
    );
}

pub fn append(stage: &str, message: &str) {
    let Ok(mut guard) = state().lock() else {
        return;
    };
    let Some(current) = guard.as_mut() else {
        return;
    };
    let elapsed_ms = current.started.elapsed().as_millis();
    let _ = writeln!(
        current.file,
        "[{}][+{elapsed_ms:>8}ms][{:?}][{stage}] {message}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        std::thread::current().id(),
    );
    let _ = current.file.flush();
}

pub fn finish(message: &str) {
    append("run", message);
}
