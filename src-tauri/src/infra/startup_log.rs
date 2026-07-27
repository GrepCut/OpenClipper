use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::OnceLock,
    time::Instant,
};

pub const FILE_STEM: &str = "open-clipper-startup";
static PROCESS_STARTED_AT: OnceLock<Instant> = OnceLock::new();

pub fn elapsed_ms() -> u128 {
    PROCESS_STARTED_AT
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis()
}

pub fn context() -> String {
    format!("pid={}; elapsed_ms={}", std::process::id(), elapsed_ms())
}

pub fn directory() -> PathBuf {
    dirs::download_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(std::env::temp_dir)
}

pub fn path() -> PathBuf {
    directory().join(format!("{FILE_STEM}.log"))
}

/// Awaryjny zapis działający jeszcze zanim Tauri i globalny logger zostaną
/// zainicjalizowane. Każde wywołanie otwiera plik tylko na czas jednego wpisu.
pub fn append(message: &str) {
    let path = path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "[{}][bootstrap] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            message
        );
        let _ = file.flush();
    }
}

pub fn install_panic_hook() {
    PROCESS_STARTED_AT.get_or_init(Instant::now);
    append(&format!(
        "process started; version={}; pid={}; executable={}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|error| format!("<unavailable: {error}>"))
    ));

    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        append(&format!(
            "PANIC: {panic_info}; thread={:?}; backtrace={}",
            std::thread::current().id(),
            std::backtrace::Backtrace::force_capture()
        ));
        previous_hook(panic_info);
    }));
}
