use crate::settings::Settings;
use once_cell::sync::OnceCell;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Emitter, Manager};

static APP: OnceCell<AppHandle> = OnceCell::new();

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> &'static AppHandle {
    APP.get().expect("app handle")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureKind {
    Screenshot,
    Video,
    Gif,
}

/// A finished capture living on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureItem {
    pub id: String,
    pub kind: CaptureKind,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    /// unix ms
    pub created: i64,
    pub size: u64,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub thumb: String,
    /// true once written to the export location / chosen by the user
    #[serde(default)]
    pub saved: bool,
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub ocr_text: Option<String>,
}

impl CaptureItem {
    pub fn file_name(&self) -> String {
        std::path::Path::new(&self.path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default()
    }
}

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub session: Mutex<Option<crate::capture::Session>>,
    pub qa_items: Mutex<Vec<CaptureItem>>,
    pub qa_closed: Mutex<Vec<CaptureItem>>,
    pub qa_hidden: AtomicBool,
    pub history: Mutex<crate::history::History>,
    pub recording: Mutex<Option<crate::recording::Recording>>,
    pub scrolling: Mutex<Option<crate::scrolling::ScrollSession>>,
    pub prev_app: Mutex<Option<crate::macos::FrontApp>>,
    pub desktop_icons_hidden: AtomicBool,
    pub pins_hidden: AtomicBool,
    pub pins: Mutex<Vec<crate::pins::PinInfo>>,
    pub last_capture: Mutex<Option<CaptureItem>>,
}

impl AppState {
    pub fn new() -> Self {
        let settings = Settings::load();
        // before the history index is read from the data folder
        crate::paths::set_data_root(&settings.storage_location);
        Self {
            settings: RwLock::new(settings),
            session: Mutex::new(None),
            qa_items: Mutex::new(vec![]),
            qa_closed: Mutex::new(vec![]),
            qa_hidden: AtomicBool::new(false),
            history: Mutex::new(crate::history::History::load()),
            recording: Mutex::new(None),
            scrolling: Mutex::new(None),
            prev_app: Mutex::new(None),
            desktop_icons_hidden: AtomicBool::new(false),
            pins_hidden: AtomicBool::new(false),
            pins: Mutex::new(vec![]),
            last_capture: Mutex::new(None),
        }
    }
}

pub fn state() -> tauri::State<'static, AppState> {
    app().state::<AppState>()
}

pub fn settings() -> Settings {
    state().settings.read().clone()
}

pub fn update_settings<F: FnOnce(&mut Settings)>(f: F) {
    let s = {
        let st = state();
        let mut w = st.settings.write();
        f(&mut w);
        w.save();
        w.clone()
    };
    let _ = app().emit("settings-changed", &s);
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}
