use std::path::PathBuf;

pub const BUNDLE_ID: &str = "com.screenshotx.app";

fn ensure(p: PathBuf) -> PathBuf {
    let _ = std::fs::create_dir_all(&p);
    p
}

/// `~/Library/Application Support/com.screenshotx.app`: settings.json always
/// lives here, and it is the default data folder.
pub fn config_dir() -> PathBuf {
    ensure(dirs::config_dir().unwrap_or_else(std::env::temp_dir).join(BUNDLE_ID))
}

/// Custom data folder (Settings → Advanced → Storage location), if any.
static DATA_ROOT: std::sync::RwLock<Option<PathBuf>> = std::sync::RwLock::new(None);

/// Point the data folder at `location` ("" = the default).
pub fn set_data_root(location: &str) {
    let root = (!location.trim().is_empty()).then(|| expand_tilde(location.trim()));
    *DATA_ROOT.write().unwrap() = root;
}

/// Captures, Capture History, thumbnails and the history index.
pub fn data_dir() -> PathBuf {
    match DATA_ROOT.read().unwrap().clone() {
        Some(p) => ensure(p),
        None => config_dir(),
    }
}

/// Where fresh captures live until the user saves them somewhere.
pub fn captures_dir() -> PathBuf {
    ensure(data_dir().join("Captures"))
}

/// Copies of every capture kept for Capture History.
pub fn history_dir() -> PathBuf {
    ensure(data_dir().join("History"))
}

pub fn thumbs_dir() -> PathBuf {
    ensure(data_dir().join("Thumbnails"))
}

pub fn temp_dir() -> PathBuf {
    ensure(std::env::temp_dir().join(BUNDLE_ID))
}

/// Return a path in `dir` named `stem.ext` that does not exist yet
/// ("name 2.png", "name 3.png", ...).
pub fn unique_path(dir: &std::path::Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut i = 2;
    while p.exists() {
        p = dir.join(format!("{stem} {i}.{ext}"));
        i += 1;
    }
    p
}

pub fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}
