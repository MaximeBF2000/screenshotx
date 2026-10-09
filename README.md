# Screenshot X

A macOS screenshot and screen-recording tool modeled on CleanShot X, built with
**Rust + Tauri 2 + React + TypeScript + Tailwind**. It runs fully locally (no cloud).

## Features

**Capture**
- Capture Area, with a crosshair, a pixel magnifier and a live size label. Hold ⇧ for a square, ⌥ to resize from the center, and Space while dragging to move the selection. Press Space before dragging to switch to window mode. Right-click or Esc cancels.
- Capture Window: hover highlight, optional shadow (hold ⌥ to drop it), and a transparent, wallpaper or plain-color background with padding.
- Capture Fullscreen, Capture Previous Area, and a Self-Timer with a countdown.
- All-In-One: an editable selection with resize handles, W×H fields, aspect-ratio and size presets, and one-click screenshot, window, fullscreen, self-timer, scrolling, OCR, video or GIF. It remembers the last selection.
- Scrolling Capture: stitches frames while you scroll, keeps sticky headers and footers once, works vertically or horizontally, and can auto-scroll. A live preview shows the result as it grows.
- Capture Text (OCR) with Vision. It also reads QR codes and barcodes, can keep line breaks, detects links ("Open link?"), and lets you choose a language.
- Freeze screen, an optional cursor in captures, and Hide Desktop Icons (while capturing, or as a toggle).
- Shortcut variants: Capture Area & Copy, & Save, & Annotate, & Pin.

**Quick Access Overlay**
- A stack of thumbnails in a screen corner (left or right), with adjustable size, and it follows the active screen.
- Hover buttons: Copy, Save, Annotate, Pin, Share and Close. You can also drag a thumbnail into any app, swipe it away, or double-click to edit.
- Right-click menu: Save As, Rename, Show in Finder, Quick Look (Space), rotate, flip, scale Retina to 1x, Close All, Save All, Hide Temporarily, and Move to Trash.
- Auto-close (close, or save and close), ask for a name after each capture, file info, and Restore Last Capture.

**Annotate**
- Tools: crop (aspect ratios, edge snapping, expand the canvas), rectangle and ellipse (outline or filled; F toggles), line, arrow (standard, fancy, double, curved), text (7 styles, emoji), pixelate, secure or smooth blur, spotlight, counter (1, A, a, I, i), smoothed pencil, and highlighter (freehand or rectangle).
- Background tool: 20 gradients, desktop or blurred wallpaper, custom images, and plain colors. Adjust padding, inset, shadow and corners, with auto-balance, 3×3 alignment and aspect ratios. Presets can be applied automatically to every screenshot.
- Editing: select, move, resize, ⌥-drag to duplicate, arrange, nudge with the arrow keys, undo/redo, zoom and pan.
- Add images: from a new screenshot, a file, the clipboard, or drag & drop.
- Rotate, flip, resize, flatten, and revert to the original.
- Output: Save, Save As (PNG, JPEG, HEIC, WebP, or an editable `.screenshotx` project), Copy, Drag me, Share, Pin, Print, and send to Quick Access.

**Pins**: floating, always-on-top screenshots. Resize them with scroll or pinch, nudge them with the arrow keys, and set opacity (keys 0–9). Lock mode makes a pin click-through; it fades when hovered, and holding ⌥ lets you interact with it again. Pins can be hidden or closed all at once.

**Recording**
- Video (H.264 or HEVC) or GIF, of an area, a window or the full screen, via ScreenCaptureKit.
- Microphone (pick the device) and computer audio, on a single mixed track or on separate tracks, optionally mono.
- Camera bubble (circle, rounded or square; three sizes; mirrored). Click it to toggle full screen.
- Click highlights (filled or outline, color, size, animation) and keystrokes (dark or light, position, size, or only command keys).
- Countdown, dimmed surroundings, controls (pause/resume, restart, delete, stop), and a timer in the menu bar.
- FPS, maximum resolution, Retina at 1x, hide desktop icons, and open the Video Editor afterwards.

**Video Editor**: trim on a filmstrip timeline (I/O keys), quality and resolution presets, audio (mute, mono, volume), GIF export (FPS, width, quality), and an estimated file size.

**Color picker**: saturation/brightness square, hue, opacity, hex, a screen eyedropper, presets and favorites. The highlighter keeps its own color and opacity.

**Open With**: right-click an image or video in Finder → Open With → Screenshot X (images open in Annotate, videos in the Video Editor).

**Also included**: Capture History (filters, search, restore, drag-out; kept 1 day to 3 months), an onboarding flow, a menu-bar menu, configurable global shortcuts (including the macOS defaults), launch at login, a Dock icon toggle, shutter sounds, a file-name pattern builder, and the full Settings window.

## URL scheme

Enable it in **Settings → Advanced**, or approve the first request.

```
screenshotx://all-in-one?x=&y=&width=&height=&display=
screenshotx://capture-area?x=&y=&width=&height=&display=&action=copy|save|annotate|pin
screenshotx://capture-previous-area?action=
screenshotx://capture-fullscreen?action=&display=
screenshotx://capture-window?action=
screenshotx://self-timer?action=
screenshotx://scrolling-capture?x=&y=&width=&height=&display=&start=true&autoscroll=true
screenshotx://record-screen?x=&y=&width=&height=&display=
screenshotx://capture-text?filepath=&linebreaks=false
screenshotx://pin?filepath=
screenshotx://open-annotate?filepath=
screenshotx://open-from-clipboard
screenshotx://toggle-desktop-icons | hide-desktop-icons | show-desktop-icons
screenshotx://add-quick-access-overlay?filepath=
screenshotx://open-history | restore-recently-closed | close-all-overlays
screenshotx://open-settings?tab=general|wallpaper|shortcuts|quickaccess|recording|screenshots|annotate|advanced|about
```

Coordinates use points with the origin at the bottom-left of the display (same as CleanShot's API).

## Development

Requirements: macOS 15+, Rust, Node, and pnpm.

```bash
pnpm install
```

```bash
pnpm tauri build --debug --bundles app
```

The app is signed with a local identity named "Screenshot X Dev" (`bundle.macOS.signingIdentity`), so the
Screen Recording permission survives rebuilds. Only build through `tauri build`: a plain `cargo build`
compiles a second copy of every dependency.

Logs are written to `~/Library/Logs/Screenshot X/app.log`. JavaScript errors from every window are forwarded there too.

UI-only work can be previewed in a browser with `pnpm dev`, then opening
`http://localhost:1420/?view=annotate&path=/dev/sample.png`. Other views: `overlay&mode=allInOne`,
`prefs`, `history`, `video`, `quickaccess`. Native calls are mocked in dev.

## Architecture

- `src-tauri/src/`
  - `capture.rs`: capture sessions, overlays and commits.
  - `sck.rs`: ScreenCaptureKit and window lists.
  - `recording.rs`: `SCStream` + `SCRecordingOutput`, with pause/resume as joined segments.
  - `video.rs`: AVFoundation export, mixing, thumbnails and GIF output via gifski.
  - `scrolling.rs`: the frame stitcher.
  - `ocr.rs`: Vision.
  - `quick_access.rs`, `pins.rs`, `history.rs`, `desktop.rs`: desktop-icon cover windows.
  - `windows.rs`: windows and non-activating NSPanels.
  - `actions.rs`: every command, shared by shortcuts, the menu and the URL scheme.
  - `urlscheme.rs`, `settings.rs`.
- `src/views/`: one React view per window type (overlay, quickaccess, annotate, pin, prefs, history, video,
  recording controls/effects/camera, scrolling preview, toast, onboarding).

The overlays, Quick Access, pins and recording controls are non-activating panels, so the app being
captured keeps focus and its window chrome stays active.
