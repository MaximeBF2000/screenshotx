# Development

Setup and build commands are in the [README](../README.md#setup). This page covers how the code is organized
and how to debug it.

## Project layout

```
src/                 React + TypeScript UI (Vite, Tailwind v4, zustand)
  views/             one view per window type, picked with ?view=
  components/        shared controls (ui.tsx, ColorPicker.tsx, Dim.tsx)
  lib/               IPC wrapper + dev mocks, settings store, session keys
src-tauri/           Rust (Tauri 2)
  src/               native code, see below
  Info.plist         usage strings, document types (Open With, .screenshotx)
  tauri.conf.json    bundle id, signing identity, URL scheme
dev/sample.png       sample image for the browser preview
docs/                this documentation
```

### Rust modules (`src-tauri/src/`)
- `capture.rs`: capture sessions, overlay windows and commits.
- `sck.rs`: ScreenCaptureKit captures and window lists.
- `recording.rs`: `SCStream` + `SCRecordingOutput`; pause/resume records segments that are joined at the end.
- `video.rs`: AVFoundation export, audio mixing, thumbnails, GIFs (gifski).
- `scrolling.rs`: the scrolling-capture stitcher.
- `ocr.rs`: Vision text and barcode recognition.
- `quick_access.rs`, `pins.rs`, `annotate.rs`, `history.rs`, `desktop.rs` (desktop-icon cover windows).
- `output.rs`: what happens after a capture (save, copy, history, thumbnails).
- `paths.rs`, `storage.rs`: the settings and data folders, and moving the data folder.
- `windows.rs`: window creation and non-activating `NSPanel`s.
- `hotkeys.rs`: global shortcuts, plus temporary "session keys" (Esc, Enter, Space, arrows) while an overlay is
  up.
- `hover.rs`: mouse tracking for panels.
- `actions.rs`: every user action, shared by shortcuts, the menu-bar menu and the URL scheme.
- `commands.rs`: Tauri commands called from the UI. `urlscheme.rs`, `settings.rs`, `state.rs`, `tray.rs`.

### Why panels, session keys and hover tracking
The overlays, Quick Access, pins and recording controls are non-activating panels: the app you're capturing
keeps focus and its window chrome stays active. Because Screenshot X itself stays inactive, those panels
don't get keyboard events or hover events from WebKit:
- **Keys**: `hotkeys.rs` registers temporary global hotkeys while a panel needs them and forwards them as
  `session-key` events (`src/lib/sessionKeys.ts` → `useKeys`).
- **Hover**: `hover.rs` polls the mouse position and emits `hover` events to Quick Access and pins.

Panels use their own window levels (`macos::Level`). The capture overlay sits at screen-saver level, above
the menu bar.

## Preview the UI in a browser

```bash
pnpm dev
```

Then open a view, for example `http://localhost:1420/?view=annotate&path=/dev/sample.png`. Other views:
`?view=overlay&mode=allInOne`, `prefs` (add `&tab=advanced`), `history`, `video`, `quickaccess`. In the
browser, native commands are mocked (`registerMock` in `src/main.tsx`), and the editor store is exposed as
`window.__annotate` for scripting.

## Logs

`~/Library/Logs/Screenshot X/app.log`: Rust logs, panics, and JavaScript errors forwarded from every window.
Settings → About → Open Logs opens the folder.

## Debug-only URL commands

Debug builds (`pnpm tauri dev`, or `tauri build --debug`) accept extra URL commands for testing without
clicking:

| Command | What it does |
| --- | --- |
| `screenshotx://debug-snap?path=` | Captures the display under the mouse, including Screenshot X's own windows |
| `screenshotx://debug-record?secs=&kind=video\|gif` | Records a region for N seconds |
| `screenshotx://debug-qa?action=&arg=` | Runs a Quick Access action on the newest card |
| `screenshotx://debug-window?path=` | Captures Screenshot X's Settings window (tests the window-capture pipeline) |
| `screenshotx://debug-export?quality=&audio=&format=` | Exports a video with the editor pipeline |
| `screenshotx://debug-keystate` | Logs which of the app's windows are key |
| `screenshotx://debug-close-windows` | Closes editor and pin windows opened by tests |

Set `SX_NO_HOTKEYS=1` to start without registering global shortcuts.

## Pitfalls
- **Single instance**: a built app exits right away while `pnpm tauri dev` is running.
- **Build only through `tauri build`**: `cargo build` compiles a separate copy of every dependency.
- **`strip = false`** stays in `Cargo.toml`: stripping corrupted the proc-macro libraries on this setup
  ("can't find crate tauri_macros").
- **Signing**: keep the same identity between builds, or macOS asks for the permissions again (see the
  README).
- **Panels**: call `set_floating_panel` before `set_level`. `setFloatingPanel:` resets the level to 3, below
  the menu bar.
- **Disk space**: `src-tauri/target` grows to several GB. Delete it when space runs low.
