# Settings

Open Settings from the menu-bar icon, or with `screenshotx://open-settings?tab=…`. Changes apply right away
and are saved to `~/Library/Application Support/Screenshot X/settings.json`.

## General
- **Startup**: start at login.
- **Sounds**: play sounds, shutter sound.
- **Menu bar / Dock**: show the menu-bar icon (when hidden, launch the app again to open Settings) and the
  Dock icon.
- **Desktop icons**: hide them while capturing.
- **Export location**: where Save puts files (default `~/Downloads`).
- **After capture**: what happens after a screenshot or a recording (Quick Access, copy, save, open the
  editor…), set separately for each.
- **Copy to clipboard**: copy the file and the image (default), the image only, or the file only.
- **File name**: ask for a name after every capture.

## Wallpaper
The wallpaper used by the Background tool and window captures: the desktop wallpaper, a custom image or a
plain color.

## Shortcuts
A global shortcut for every action. **Use System Default Shortcuts…** assigns ⇧⌘3/4/5/2/6 (turn off the
macOS screenshot shortcuts first). You can also ignore the
"After capture" actions for the "Capture Area & …" shortcuts.

## Quick Access
Position (left or right), overlay size, move to the active screen, auto-close (and what it does), close
after dragging, file info on hover, and tips.

## Recording
- Countdown, cursor, Do Not Disturb, dim screen, hide desktop icons, remember the last selection, and open
  the Video Editor afterwards.
- Recording time in the menu bar, and controls while recording.
- Click highlights and keystrokes (style, color, size, position).
- Camera shape, size and mirroring.
- Video FPS, encoder (H.264 / HEVC), maximum resolution, Retina at 1x.
- Audio: mono, and a single mixed track or separate tracks. The microphone, computer audio and camera are
  picked in the setup bar shown before each recording.
- GIF FPS, size, quality and optimization.

## Screenshots
File format, Retina scaling and `@2x` suffix, 1px border, cursor, window shadow and background, freeze
screen, crosshair mode, magnifier, All-In-One "remember last selection", self-timer interval, an automatic
Background tool preset, and text recognition: the engine (Ollama with a local model, GLM-OCR by default, or
Apple Vision), the Ollama server and model with a status line and a Download button, line breaks, links, and
the language (Apple Vision only).

## Annotate
Inverse arrow direction, smooth pencil drawing, remember whether the Background tool was open, shadows on
objects, color names, always on top, Save button behavior (export location or ask), and close after copying.

## Advanced
- **File name**: the pattern for new files, built from tokens (date, time, app name, window title, counter…),
  with UTC time and illegal-character removal.
- **Pinned screenshots**: show pins on screenshots, fade locked pins, shadow.
- **Keep captures**: how long a capture is kept once nothing uses it (no Quick Access card, pin or editor),
  separately for images and videos: 1, 5 (default), 15 or 30 minutes, or 1 hour. Quitting deletes every
  capture; saved files are never deleted.
- **Storage location**: the data folder for captures and logs. **Choose…** moves the existing
  data to the new folder, **Reset** moves it back to the default. See [storage.md](storage.md).
- **URL scheme**: allow other apps to control Screenshot X.
- **Dialogs**: reset the warnings you dismissed.
- **Permissions**: status and shortcuts for Screen Recording, Accessibility, and Camera & Microphone.

## About
Version, and buttons to open the logs, open Capture History, and quit.
