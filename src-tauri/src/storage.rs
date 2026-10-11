//! Moving the data folder (captures and logs) to a user-chosen location.

use crate::paths;
use crate::state;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// What lives in the data folder.
const ENTRIES: [&str; 2] = ["Captures", "Logs"];

/// Resolve a "Storage location" setting to a folder ("" = the default).
fn resolve(location: &str) -> PathBuf {
    if location.trim().is_empty() {
        paths::config_dir()
    } else {
        paths::expand_tilde(location.trim())
    }
}

/// Move a file or folder, across volumes too. Folders merge into an existing
/// destination; files already there are kept.
fn move_entry(src: &Path, dst: &Path) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }
    if !dst.exists() && std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for e in std::fs::read_dir(src)?.flatten() {
            move_entry(&e.path(), &dst.join(e.file_name()))?;
        }
        let _ = std::fs::remove_dir(src);
    } else if !dst.exists() {
        std::fs::copy(src, dst).with_context(|| format!("copying {}", src.display()))?;
        std::fs::remove_file(src)?;
    }
    Ok(())
}

fn rebase(p: &mut String, from: &str, to: &str) {
    if let Some(rest) = p.strip_prefix(from) {
        *p = format!("{to}{rest}");
    }
}

/// Switch the data folder to `location` ("" = default), moving existing data.
/// Returns the new folder.
pub fn set_location(app: &AppHandle, location: &str) -> Result<PathBuf> {
    let old = paths::data_dir();
    let new = resolve(location);
    if new == old {
        return Ok(new);
    }
    if new.starts_with(&old) && ENTRIES.iter().any(|e| new.starts_with(old.join(e))) {
        bail!("Choose a folder outside the current Captures or Logs folders.");
    }
    std::fs::create_dir_all(&new).with_context(|| format!("creating {}", new.display()))?;
    let probe = new.join(".screenshotx-write-test");
    std::fs::write(&probe, b"").with_context(|| format!("{} is not writable", new.display()))?;
    let _ = std::fs::remove_file(probe);

    let st = state::state();
    // hold the history lock so no capture is added meanwhile
    let mut history = st.history.lock();
    for e in ENTRIES {
        move_entry(&old.join(e), &new.join(e))?;
    }
    let (from, to) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
    for it in history.items.iter_mut() {
        rebase(&mut it.path, &from, &to);
        rebase(&mut it.thumb, &from, &to);
    }
    for it in st.qa_items.lock().iter_mut().chain(st.qa_closed.lock().iter_mut()) {
        rebase(&mut it.path, &from, &to);
        rebase(&mut it.thumb, &from, &to);
    }
    if let Some(it) = st.last_capture.lock().as_mut() {
        rebase(&mut it.path, &from, &to);
        rebase(&mut it.thumb, &from, &to);
    }
    for p in st.pins.lock().iter_mut() {
        rebase(&mut p.path, &from, &to);
    }
    let stored = if new == paths::config_dir() { String::new() } else { to.clone() };
    paths::set_data_root(&stored);
    drop(history);
    state::update_settings(|s| s.storage_location = stored);
    log::info!("storage moved: {from} -> {to}");
    let _ = app.emit("history:update", ());
    Ok(new)
}
