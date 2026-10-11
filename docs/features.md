# Features

Every feature, grouped by area. Global shortcuts are not set by default: assign them in **Settings →
Shortcuts**, or pick "Use macOS Shortcuts" during onboarding (⇧⌘3 fullscreen, ⇧⌘4 area, ⇧⌘5 All-In-One,
⇧⌘2 text, ⇧⌘6 record). Every action is also in the menu-bar menu and in the [URL scheme](url-scheme.md).

## Capture

### Capture Area
- A crosshair, a pixel magnifier and a live size label follow the cursor. The selection can start anywhere
  on screen, including the menu bar.
- While dragging: hold **⇧** for a square, **⌥** to resize from the center, and **Space** to move the
  selection.
- **Space** before dragging selects the whole screen and opens the All-In-One toolbar (screenshot, scrolling,
  OCR, video, GIF…). **Enter** without a selection captures the full screen.
- **Right-click** or **Esc** cancels.
- Shortcut variants run one action straight away: Capture Area & Copy, & Save, & Annotate, & Pin.

### Capture Window
- Windows highlight on hover; click to capture.
- Captures the window shadow by default. Hold **⌥** while clicking to drop it.
- Optional background behind the window: transparent, wallpaper or plain color, with padding (Settings →
  Screenshots → Window screenshot).
- Screenshot X's own editor and Settings windows can be captured too. Its overlays never appear in captures.

### Other modes
- **Capture Fullscreen**, **Capture Previous Area** and **Self-Timer** (countdown, interval set in Settings →
  Screenshots).
- **Freeze screen**: freezes the screen while you select, to catch menus and tooltips.
- **Cursor**: optionally included in fullscreen, previous-area and self-timer captures.
- **Hide Desktop Icons**: while capturing, or as a toggle from the menu.

### All-In-One
An editable selection with resize handles and W×H fields, aspect-ratio and size presets, and one-click
screenshot, window, fullscreen, self-timer, scrolling, OCR, video or GIF.
- It opens on the last region you selected in any mode (All-In-One, Capture Area, recording, scrolling, OCR).
- **Space** selects the whole screen. Arrow keys move the selection (⇧ for 10 pt steps) and ⌘/⌥ + arrows
  resize it. **Enter** captures.
- **Esc** clears the selection first, so you can draw a new one; a second **Esc** leaves. Clearing only
  affects this session: the next All-In-One opens on the remembered region again.

### Scrolling Capture
- Select an area, start, then scroll: frames are stitched as you go. Works vertically or horizontally, keeps
  sticky headers and footers only once, and can auto-scroll.
- A live preview shows the result as it grows.
- **Enter** finishes (same as **Done**), **Esc** cancels.

### Capture Text (OCR)
- Recognizes text and copies it. Two engines (Settings → Screenshots → Text recognition):
  - **Ollama** (default): a local model, GLM-OCR by default (`ollama pull glm-ocr`, or the Download button in
    Settings). The server URL and model are configurable.
  - **Apple Vision**: on device, no setup. Used automatically when Ollama isn't running or the model is
    missing.
- QR codes and barcodes are always read with Apple Vision.
- Options: keep line breaks, detect links ("Open link?"), recognition language (Apple Vision).
- "Capture Text Without Line Breaks" is a separate action.

## Quick Access Overlay
- After each capture, a thumbnail appears in a screen corner (left or right, adjustable size). Captures stack.
- A capture stays as long as its card is open. Once closed, it can be restored for a few minutes (Restore
  Recently Closed, or Capture History), then it's deleted unless you saved it.
- It follows the active screen when you work on several displays, and hides while you select a new capture.
- Hover buttons: **Copy** and **Save** in the middle; **Close**, **Preview** (Quick Look), **Edit** and **Pin**
  in the corners.
- Drag a thumbnail into any app to drop the file. Swipe it away to close it. Double-click to edit.
- Keyboard while hovering a card: **Space** Quick Look, **⌘C** copy, **⌘S** save, **⌘P** pin, **Enter**
  edit, **Esc** / **⌫** / **⌘W** close.
- Right-click menu: Save As, Rename, Show in Finder, Quick Look, rotate, flip, scale Retina to 1x, Close All,
  Save All, Hide Temporarily, Move to Trash.
- Auto-close (close, or save and close), ask for a name after each capture, file info on hover, and
  Restore Last Capture.

## Annotate (image editor)

### Tools
Each tool has a one-letter shortcut. Drawing tools always draw, even over existing annotations (a pen
stroke over a spotlight, for example). Only the Select tool picks up objects; with another tool, hold **⌘**
to grab and move one. The Text tool edits a text you click on.

| Tool | Key | Notes |
| --- | --- | --- |
| Select / move | V | ⌥-drag duplicates, arrow keys nudge (⇧ for 10 pt) |
| Crop | C | Aspect ratios, edge snapping, can expand the canvas on purpose. Enter applies, Esc cancels |
| Rectangle | R | Outline or filled (**F** toggles), corner radius |
| Ellipse | O / E | Outline or filled (**F** toggles) |
| Line | L | |
| Arrow | A | Standard, fancy, double, curved. ⌥ inverts the direction |
| Text | T | 7 styles with previews, emoji, alignment. Corner handles scale the font, side handles set the wrap width |
| Pixelate / blur | P | Pixelate, secure blur or smooth blur, with intensity |
| Spotlight | S | Rectangle or ellipse. One shared **Darkness** (15–85%) for all spotlights, so they never stack |
| Counter | N | 1, A, a, I, i |
| Pencil | D | Optional smoothing |
| Highlighter | H | Freehand or rectangle, with its own color and opacity |
| Background | B | See below |

**[** and **]** change the stroke size (or the font size for text).

### Background tool
- 20 gradients, desktop or blurred wallpaper, custom images and plain colors.
- Padding, inset, shadow and corner radius. The inset color matches the screenshot's edges (Auto) or uses a
  color you pick.
- Auto-balance, 3×3 alignment and aspect ratios.
- Save presets and apply one automatically to every screenshot.
- Annotations can sit in the padding without changing the layout.

### Editing
- Annotations never enlarge the image: anything outside it is cropped at the edge.
- Undo/redo (⌘Z / ⇧⌘Z), copy/cut/paste/duplicate objects (⌘C, ⌘X, ⌘V, ⌘D), select all (⌘A), delete (⌫).
- Arrange with ⌘↑ / ⌘↓ (⌥⌘↑ / ⌥⌘↓ to front or back).
- Zoom: ⌘+ / ⌘−, ⌘0 to fit, ⌘1 for 100%.
- Add images from a new screenshot, a file, the clipboard or drag & drop.
- Rotate, flip, resize, flatten annotations, and revert to the original.

### Color picker
Saturation/brightness square, hue and opacity sliders, hex input, a screen eyedropper, presets and favorites.

### Output
- **Save** (⌘S, ⌥⌘S keeps the window open), **Save As** (⇧⌘S: PNG, JPEG, HEIC, WebP, or an editable
  `.screenshotx` project), **Copy** (⌘C with nothing selected).
- **Drag me**: drag the result into any app.
- Share, Pin (⇧⌘P), Print (⌘P), and send to Quick Access.

## Pins
- Floating, always-on-top screenshots.
- Resize with scroll, pinch or ⌘+ / ⌘− (⌘0 resets). Nudge with the arrow keys. Set opacity with 1–9 (0 =
  100%).
- **L** locks a pin: it becomes click-through and fades when hovered. Hold **⌥** to interact with it again.
- ⌘C copies, ⌘S saves, Esc / ⌘W closes. Pins can be hidden or closed all at once.

## Screen recording
- Video (H.264 or HEVC) or GIF, of an area, a window or the full screen, through ScreenCaptureKit.
- Before recording, a setup bar lets you pick the microphone, turn computer audio and the camera on or off,
  and switch between video and GIF. Defaults come from Settings → Recording.
- Microphone and computer audio on one mixed track or separate tracks, optionally mono.
- Camera bubble: circle, rounded or square, three sizes, mirrored. Click it to toggle full screen.
- Click highlights (filled or outline, color, size, animation) and keystrokes (dark or light, position,
  size, or only command keys; needs the Accessibility permission).
- Countdown, dimmed surroundings, controls (pause/resume, restart, delete, stop) and a timer in the menu
  bar.
- FPS, maximum resolution, Retina at 1x, hide desktop icons, Do Not Disturb, and open the Video Editor
  afterwards.

## Video Editor
- Trim on a filmstrip timeline: **I** / **O** set the in and out points, Space plays, ← / → step one frame
  (⇧ for one second).
- Quality and resolution presets, audio (mute, mono, volume), GIF export (FPS, width, quality) and an
  estimated file size.

## Capture History
- Lists the captures that still exist: captures are ephemeral, so a closed capture is kept only for the "Keep
  captures" delay (5 minutes by default), and everything is deleted when the app quits. See
  [storage.md](storage.md).
- Filter by type, search, restore to Quick Access, or drag files out.

## Also included
- **Open With**: right-click an image or video in Finder → Open With → Screenshot X. Images open in the
  editor, videos in the Video Editor. `.screenshotx` projects open with a double-click. This needs the built
  app, not `pnpm tauri dev`.
- Onboarding, a menu-bar menu, launch at login, a Dock icon toggle, shutter sounds, and a file-name pattern
  builder.
