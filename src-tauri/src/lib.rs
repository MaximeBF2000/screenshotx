pub mod actions;
pub mod annotate;
pub mod capture;
pub mod clipboard;
pub mod commands;
pub mod desktop;
pub mod displays;
pub mod history;
pub mod hotkeys;
pub mod hover;
pub mod imageops;
pub mod input;
pub mod macos;
pub mod naming;
pub mod nativeimage;
pub mod ocr;
pub mod ocr_ollama;
pub mod output;
pub mod paths;
pub mod permissions;
pub mod pins;
pub mod quick_access;
pub mod quicklook;
pub mod recording;
pub mod sck;
pub mod scrolling;
pub mod settings;
pub mod state;
pub mod storage;
pub mod toast;
pub mod tray;
pub mod urlscheme;
pub mod video;
pub mod windows;

use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

fn sx_protocol(request: &tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path().to_string();
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    match parts.as_slice() {
        ["snapshot", session, display] => {
            let (Ok(s), Ok(d)) = (session.parse::<u64>(), display.parse::<u32>()) else { return not_found() };
            match capture::snapshot_bmp(s, d) {
                Some(bytes) => Response::builder()
                    .header(header::CONTENT_TYPE, "image/bmp")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(bytes.as_ref().clone())
                    .unwrap(),
                None => not_found(),
            }
        }
        ["file", ..] => {
            // sx://localhost/file?p=<urlencoded path>
            let q = request.uri().query().unwrap_or("");
            let p = q
                .split('&')
                .find_map(|kv| kv.strip_prefix("p="))
                .and_then(|v| urlencoding::decode(v).ok())
                .map(|c| c.to_string());
            let Some(p) = p else { return not_found() };
            match std::fs::read(&p) {
                Ok(bytes) => {
                    let mime = match std::path::Path::new(&p).extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
                        Some("png") => "image/png",
                        Some("jpg" | "jpeg") => "image/jpeg",
                        Some("gif") => "image/gif",
                        Some("webp") => "image/webp",
                        Some("heic") => "image/heic",
                        Some("svg") => "image/svg+xml",
                        Some("mp4" | "m4v") => "video/mp4",
                        Some("mov") => "video/quicktime",
                        _ => "application/octet-stream",
                    };
                    Response::builder()
                        .header(header::CONTENT_TYPE, mime)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(bytes)
                        .unwrap()
                }
                Err(_) => not_found(),
            }
        }
        _ => not_found(),
    }
}

/// Open a file handed to the app by Finder: images go to Annotate, videos
/// to the Video Editor.
pub fn open_file(app: &tauri::AppHandle, p: &std::path::Path) {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let path = p.to_string_lossy().to_string();
    match ext.as_str() {
        "mp4" | "mov" | "m4v" => video::open_editor(app, &path),
        _ => annotate::open(app, &path, None),
    }
}

/// Appends to `<data folder>/Logs/app.log`, reopening the file for each
/// record so logging follows the data folder when it moves.
struct LogFile;

impl std::io::Write for LogFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(paths::logs_dir().join("app.log"))?;
        f.write_all(buf)?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn run() {
    // the data folder (and so the logs) can be moved in Settings → Advanced
    paths::set_data_root(&settings::Settings::load().storage_location);
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,tao=warn,wry=warn"))
        .target(env_logger::Target::Pipe(Box::new(LogFile)))
        .init();
    log::info!("Screenshot X starting");
    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}\n{}", std::backtrace::Backtrace::force_capture());
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Launching the app again opens Settings (like CleanShot), or
            // forwards a deep link.
            if let Some(url) = args.iter().find(|a| a.starts_with("screenshotx://")) {
                urlscheme::handle(app, url);
            } else {
                let app = app.clone();
                std::thread::spawn(move || commands::open_settings(&app, None));
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_nspanel::init())
        .register_asynchronous_uri_scheme_protocol("sx", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(sx_protocol(&request)));
        })
        .manage(state::AppState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            state::set_app(handle.clone());
            let s = state::settings();
            macos::set_activation_policy(&handle, s.show_dock_icon);
            macos::enable_background_cursor();
            tray::init(&handle)?;
            hotkeys::register_all(&handle);

            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = handle.clone();
                app.deep_link().on_open_url(move |ev| {
                    for u in ev.urls() {
                        let s = u.to_string();
                        if s.starts_with("screenshotx://") {
                            urlscheme::handle(&h, &s);
                        }
                        // file URLs are handled by RunEvent::Opened
                    }
                });
            }

            // captures are ephemeral: leftovers from a session that didn't
            // quit cleanly go first, then unused captures expire after a few minutes
            history::purge_all();
            {
                let h = handle.clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(history::SWEEP_INTERVAL);
                    history::sweep(&h);
                });
            }

            // Warm up the windows that must appear instantly.
            capture::prewarm_overlays(&handle);
            quick_access::prewarm(&handle);

            if !s.onboarding_done {
                windows::open_regular(&handle, "onboarding", "onboarding", "Welcome to Screenshot X", 640.0, 560.0, false);
            } else if !macos::has_screen_permission() {
                permissions::prompt_screen_recording(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::get_actions,
            commands::shortcut_display,
            commands::shortcuts_suspend,
            commands::shortcut_available,
            commands::run_action,
            commands::window_ready,
            commands::close_window,
            commands::make_key,
            commands::set_window_frame,
            commands::window_frame,
            commands::cmd_open_settings,
            commands::cmd_open_history,
            commands::overlay_payload,
            commands::overlay_commit,
            commands::overlay_cancel,
            commands::overlay_focus,
            commands::overlay_ready,
            commands::modifiers,
            commands::mouse_location,
            commands::list_displays,
            commands::qa_state,
            commands::qa_action,
            commands::qa_close_all,
            commands::qa_save_all,
            commands::qa_restore,
            commands::qa_hide_temporarily,
            commands::toast_pending,
            commands::toast_hide,
            commands::toast_action,
            commands::pin_set_locked,
            commands::pin_open,
            commands::history_list,
            commands::history_action,
            commands::history_clear,
            commands::read_file_bytes,
            commands::write_file_bytes,
            commands::save_png_as,
            commands::file_exists,
            commands::image_info,
            commands::export_dir,
            commands::new_file_stem,
            commands::copy_file_to_clipboard,
            commands::copy_text,
            commands::clipboard_image_png,
            commands::reveal,
            commands::open_path,
            commands::open_url,
            commands::share_files,
            commands::print_image,
            commands::emoji_palette,
            commands::accent_color,
            commands::ocr_languages,
            commands::ocr_image_bytes,
            commands::wallpaper_path,
            commands::permissions_status,
            commands::request_permission,
            commands::app_version,
            commands::quit,
            commands::reset_warnings,
            commands::annotate_open,
            commands::annotate_capture_into,
            commands::renderer_done,
            commands::add_to_quick_access,
            commands::after_capture_config,
            commands::js_log,
            commands::media_devices,
            commands::rec_info,
            commands::rec_control,
            commands::camera_fullscreen,
            commands::camera_save_position,
            commands::camera_preview,
            commands::video_info,
            commands::video_filmstrip,
            commands::video_export,
            commands::video_open_editor,
            commands::scroll_control,
            commands::scroll_preview,
            commands::qa_replace,
            commands::ocr_ollama_status,
            commands::ocr_ollama_pull,
            commands::open_logs,
            commands::storage_info,
            commands::set_storage_location,
            commands::pick_color,
            commands::drag_icon,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Screenshot X")
        .run(|app, ev| match ev {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                // Closing the last window must not quit a menu bar app.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            // Quitting deletes every capture (saved files live elsewhere)
            tauri::RunEvent::Exit => history::purge_all(),
            // Finder "Open With → Screenshot X" (and dropping files on the icon)
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let app = app.clone();
                std::thread::spawn(move || {
                    for u in urls {
                        if let Ok(p) = u.to_file_path() {
                            open_file(&app, &p);
                        }
                    }
                });
            }
            tauri::RunEvent::Reopen { .. } => {
                let app = app.clone();
                std::thread::spawn(move || commands::open_settings(&app, None));
            }
            _ => {
                let _ = app;
            }
        });
}
