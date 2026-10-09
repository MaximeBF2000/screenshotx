//! Persistent user preferences. Every field has a default so older settings
//! files keep loading after new options are added.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardContent {
    FileAndImage,
    ImageOnly,
    FileOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CrosshairMode {
    Always,
    WhenCommandPressed,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WindowBackground {
    Wallpaper,
    Transparent,
    PlainColor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WallpaperSource {
    Desktop,
    Custom,
    PlainColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AfterCapture {
    pub show_quick_access: bool,
    pub copy_to_clipboard: bool,
    pub save: bool,
    pub open_annotate: bool,
    pub open_video_editor: bool,
    pub pin: bool,
}

impl Default for AfterCapture {
    fn default() -> Self {
        Self {
            show_quick_access: true,
            copy_to_clipboard: false,
            save: false,
            open_annotate: false,
            open_video_editor: false,
            pin: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // ---- General
    pub launch_at_login: bool,
    pub play_sounds: bool,
    /// "classic" | "pop" | "subtle" | "glass" | "tink"
    pub shutter_sound: String,
    pub show_menu_bar_icon: bool,
    pub show_dock_icon: bool,
    pub hide_desktop_icons_while_capturing: bool,
    pub export_location: String,
    pub after_screenshot: AfterCapture,
    pub after_recording: AfterCapture,
    pub clipboard_content: ClipboardContent,
    pub ask_for_name_after_capture: bool,

    // ---- Wallpaper
    pub wallpaper_source: WallpaperSource,
    pub custom_wallpaper_path: String,
    pub wallpaper_plain_color: String,

    // ---- Shortcuts: action id -> accelerator ("" = none)
    pub shortcuts: BTreeMap<String, String>,
    pub ignore_after_capture_for_specific_shortcuts: bool,

    // ---- Quick Access Overlay
    /// "left" | "right"
    pub qa_position: String,
    /// 0.6 .. 1.6 scale of the overlay thumbnails
    pub qa_size: f64,
    pub qa_move_to_active_screen: bool,
    pub qa_auto_close: bool,
    /// seconds
    pub qa_auto_close_interval: u32,
    /// "close" | "saveAndClose"
    pub qa_auto_close_action: String,
    pub qa_close_after_dragging: bool,
    pub qa_show_file_info: bool,
    pub qa_tips_shown: u32,

    // ---- Recording
    pub rec_show_countdown: bool,
    pub rec_countdown_seconds: u32,
    pub rec_show_cursor: bool,
    pub rec_highlight_clicks: bool,
    /// "" = system accent
    pub rec_click_color: String,
    pub rec_click_size: f64,
    /// "outline" | "filled"
    pub rec_click_style: String,
    pub rec_click_animate: bool,
    pub rec_show_keystrokes: bool,
    /// "dark" | "light"
    pub rec_keystroke_style: String,
    /// "bottomCenter" | "bottomLeft" | "bottomRight" | "topCenter"...
    pub rec_keystroke_position: String,
    pub rec_keystroke_size: f64,
    pub rec_keystroke_only_command_keys: bool,
    pub rec_do_not_disturb: bool,
    pub rec_dim_screen: bool,
    pub rec_display_time_in_menu_bar: bool,
    pub rec_show_controls: bool,
    pub rec_remember_last_selection: bool,
    pub rec_open_editor_after: bool,
    pub rec_hide_desktop_icons: bool,
    pub rec_video_fps: u32,
    /// "h264" | "hevc"
    pub rec_video_encoder: String,
    /// 0 = original, otherwise max height in px (e.g. 2160, 1440, 1080, 720)
    pub rec_max_resolution: u32,
    pub rec_scale_retina: bool,
    pub rec_audio_mono: bool,
    pub rec_gif_fps: u32,
    /// 0 = original, otherwise max width (800 default)
    pub rec_gif_max_width: u32,
    /// 1..100
    pub rec_gif_quality: u32,
    pub rec_gif_optimize: bool,
    pub rec_microphone: String,
    pub rec_record_microphone: bool,
    pub rec_record_computer_audio: bool,
    pub rec_separate_audio_tracks: bool,
    pub rec_camera: String,
    pub rec_record_camera: bool,
    /// "circle" | "roundedRect" | "square"
    pub rec_camera_shape: String,
    /// "small" | "medium" | "large"
    pub rec_camera_size: String,
    pub rec_camera_flip: bool,
    pub rec_camera_pos: Option<(f64, f64)>,
    /// "video" | "gif"
    pub rec_last_type: String,

    // ---- Screenshots
    /// "png" | "jpg" | "heic" | "webp"
    pub screenshot_format: String,
    pub jpeg_quality: u32,
    pub scale_retina_to_1x: bool,
    pub add_retina_suffix: bool,
    pub add_border: bool,
    pub window_background: WindowBackground,
    pub window_bg_color: String,
    pub window_padding: u32,
    pub capture_window_shadow: bool,
    pub freeze_screen: bool,
    pub crosshair_mode: CrosshairMode,
    pub show_magnifier: bool,
    pub self_timer_seconds: u32,
    /// "fullscreen" | "area"
    pub self_timer_mode: String,
    pub remember_last_selection: bool,
    pub capture_cursor: bool,
    pub auto_apply_background_preset: bool,
    pub auto_background_preset_id: String,
    pub ocr_keep_line_breaks: bool,
    pub ocr_detect_links: bool,
    /// "ask" | "always" | "never"
    pub ocr_open_links: String,
    pub ocr_language: String,

    // ---- Annotate
    pub annotate_inverse_arrow: bool,
    pub annotate_smooth_drawing: bool,
    pub annotate_remember_background_tool: bool,
    pub annotate_draw_shadow: bool,
    pub annotate_show_color_names: bool,
    pub annotate_auto_expand_canvas: bool,
    pub annotate_always_on_top: bool,
    /// "exportLocation" | "ask"
    pub annotate_save_behavior: String,
    pub annotate_copy_and_close: bool,
    pub annotate_last: serde_json::Value,

    // ---- Pins
    pub pins_show_on_screenshots: bool,
    pub pins_hide_on_hover_when_locked: bool,
    pub pins_shadow: bool,

    // ---- Advanced
    pub file_name_pattern: String,
    pub use_utc: bool,
    pub remove_illegal_chars: bool,
    pub auto_increment: u32,
    pub allow_url_scheme: Option<bool>,
    /// days, 0 = never keep
    pub history_days: u32,
    pub dismissed_warnings: Vec<String>,

    // ---- State
    pub onboarding_done: bool,
    pub last_area: Option<SavedArea>,
    pub last_record_area: Option<SavedArea>,
    pub last_aio_area: Option<SavedArea>,
    pub background_presets: serde_json::Value,
    pub custom_backgrounds: Vec<String>,
    pub favorite_colors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArea {
    pub display_id: u32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn default_export_location() -> String {
    dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads"))
        .to_string_lossy()
        .to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            play_sounds: true,
            shutter_sound: "classic".into(),
            show_menu_bar_icon: true,
            show_dock_icon: false,
            hide_desktop_icons_while_capturing: false,
            export_location: default_export_location(),
            after_screenshot: AfterCapture::default(),
            after_recording: AfterCapture::default(),
            clipboard_content: ClipboardContent::FileAndImage,
            ask_for_name_after_capture: false,

            wallpaper_source: WallpaperSource::Desktop,
            custom_wallpaper_path: String::new(),
            wallpaper_plain_color: "#1E1E1E".into(),

            shortcuts: BTreeMap::new(),
            ignore_after_capture_for_specific_shortcuts: true,

            qa_position: "left".into(),
            qa_size: 1.0,
            qa_move_to_active_screen: true,
            qa_auto_close: false,
            qa_auto_close_interval: 30,
            qa_auto_close_action: "close".into(),
            qa_close_after_dragging: true,
            qa_show_file_info: true,
            qa_tips_shown: 0,

            rec_show_countdown: true,
            rec_countdown_seconds: 3,
            rec_show_cursor: true,
            rec_highlight_clicks: false,
            rec_click_color: String::new(),
            rec_click_size: 1.0,
            rec_click_style: "filled".into(),
            rec_click_animate: true,
            rec_show_keystrokes: false,
            rec_keystroke_style: "dark".into(),
            rec_keystroke_position: "bottomCenter".into(),
            rec_keystroke_size: 1.0,
            rec_keystroke_only_command_keys: false,
            rec_do_not_disturb: false,
            rec_dim_screen: false,
            rec_display_time_in_menu_bar: true,
            rec_show_controls: true,
            rec_remember_last_selection: true,
            rec_open_editor_after: false,
            rec_hide_desktop_icons: false,
            rec_video_fps: 60,
            rec_video_encoder: "h264".into(),
            rec_max_resolution: 0,
            rec_scale_retina: false,
            rec_audio_mono: false,
            rec_gif_fps: 15,
            rec_gif_max_width: 800,
            rec_gif_quality: 80,
            rec_gif_optimize: true,
            rec_microphone: String::new(),
            rec_record_microphone: false,
            rec_record_computer_audio: false,
            rec_separate_audio_tracks: false,
            rec_camera: String::new(),
            rec_record_camera: false,
            rec_camera_shape: "circle".into(),
            rec_camera_size: "medium".into(),
            rec_camera_flip: true,
            rec_camera_pos: None,
            rec_last_type: "video".into(),

            screenshot_format: "png".into(),
            jpeg_quality: 90,
            scale_retina_to_1x: false,
            add_retina_suffix: false,
            add_border: false,
            window_background: WindowBackground::Transparent,
            window_bg_color: "#FFFFFF".into(),
            window_padding: 60,
            capture_window_shadow: true,
            freeze_screen: false,
            crosshair_mode: CrosshairMode::Always,
            show_magnifier: true,
            self_timer_seconds: 5,
            self_timer_mode: "fullscreen".into(),
            remember_last_selection: true,
            capture_cursor: false,
            auto_apply_background_preset: false,
            auto_background_preset_id: String::new(),
            ocr_keep_line_breaks: true,
            ocr_detect_links: true,
            ocr_open_links: "ask".into(),
            ocr_language: "auto".into(),

            annotate_inverse_arrow: false,
            annotate_smooth_drawing: true,
            annotate_remember_background_tool: true,
            annotate_draw_shadow: true,
            annotate_show_color_names: false,
            annotate_auto_expand_canvas: true,
            annotate_always_on_top: false,
            annotate_save_behavior: "exportLocation".into(),
            annotate_copy_and_close: false,
            annotate_last: serde_json::json!({}),

            pins_show_on_screenshots: false,
            pins_hide_on_hover_when_locked: true,
            pins_shadow: true,

            file_name_pattern: "Screenshot X {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}".into(),
            use_utc: false,
            remove_illegal_chars: false,
            auto_increment: 1,
            allow_url_scheme: None,
            history_days: 30,
            dismissed_warnings: vec![],

            onboarding_done: false,
            last_area: None,
            last_record_area: None,
            last_aio_area: None,
            background_presets: serde_json::json!([]),
            custom_backgrounds: vec![],
            favorite_colors: vec![],
        }
    }
}

pub fn settings_path() -> PathBuf {
    crate::paths::config_dir().join("settings.json")
}

impl Settings {
    pub fn load() -> Self {
        let path = settings_path();
        match std::fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
                log::warn!("settings parse error {e}, using defaults");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self) {
        let path = settings_path();
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(tmp, path);
            }
        }
    }

    pub fn shortcut(&self, action: &str) -> Option<&str> {
        self.shortcuts.get(action).map(|s| s.as_str()).filter(|s| !s.is_empty())
    }
}
