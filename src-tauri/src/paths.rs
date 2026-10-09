use std::path::PathBuf;

pub const BUNDLE_ID: &str = "com.screenshotx.app";

fn ensure(p: PathBuf) -> PathBuf {
    let _ = std::fs::create_dir_all(&p);
    p
}

pub fn config_dir() -> PathBuf {
    ensure(dirs::config_dir().unwrap_or_else(std::env::temp_dir).join(BUNDLE_ID))
}

/// Where fresh captures live until the user saves them somewhere.
pub fn captures_dir() -> PathBuf {
    ensure(config_dir().join("Captures"))
}

/// Copies of every capture kept for Capture History.
pub fn history_dir() -> PathBuf {
    ensure(config_dir().join("History"))
}

pub fn thumbs_dir() -> PathBuf {
    ensure(config_dir().join("Thumbnails"))
}

pub fn backgrounds_dir() -> PathBuf {
    ensure(config_dir().join("Backgrounds"))
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
