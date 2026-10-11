# Screenshot X

Screenshot X is a screenshot and screen-recording app for macOS, modeled on CleanShot X. It covers area,
window, fullscreen, scrolling and text (OCR) captures, a Quick Access overlay, an annotation editor, floating
pins, video and GIF recording, a video editor and a capture history.

It is built with **Rust + Tauri 2** on the native side (ScreenCaptureKit, AVFoundation, Vision) and
**React + TypeScript + Tailwind** for the interface. Everything runs locally: nothing is uploaded anywhere.

## Requirements

- macOS 15 or later (screen recording uses `SCRecordingOutput`)
- Xcode Command Line Tools: `xcode-select --install`
- [Rust](https://rustup.rs) (stable)
- Node.js 20+ and [pnpm](https://pnpm.io)
- Optional: [Ollama](https://ollama.com) with `glm-ocr` (`ollama pull glm-ocr`) for text recognition. Without it,
  Capture Text uses Apple Vision.

## Setup

Clone the repository and install the JavaScript dependencies:

```bash
git clone https://github.com/MaximeBF2000/screenshotx.git
```

```bash
cd screenshotx && pnpm install
```

### Run in development

```bash
pnpm tauri dev
```

This starts the Vite dev server and the app with hot reload. Changes in `src-tauri/` rebuild and restart the
app automatically. On first launch, macOS asks for the Screen Recording permission. In dev mode the
permission is granted to the terminal app that runs the command.

### Build the app

```bash
pnpm tauri build --debug --bundles app
```

The app is written to `src-tauri/target/debug/bundle/macos/Screenshot X.app`. Drop `--debug` for an
optimized release build (`src-tauri/target/release/bundle/macos/`). Only build through `tauri build`: a
plain `cargo build` compiles a second copy of every dependency.

Only one instance runs at a time. Quit `pnpm tauri dev` before opening a built app, or the built app exits
right after launch.

### Code signing

`src-tauri/tauri.conf.json` signs the app with a local identity named **"Screenshot X Dev"**. A stable
identity keeps the Screen Recording permission across rebuilds. To create it, open Keychain Access →
Certificate Assistant → Create a Certificate…, name it `Screenshot X Dev`, set the identity type to
"Self-Signed Root" and the certificate type to "Code Signing".

Without that certificate, set `bundle.macOS.signingIdentity` to `"-"` (ad-hoc signing). The app still
works, but macOS asks for the permissions again after each rebuild.

## Where your data lives

Captures are **ephemeral**: they exist while you use them, then they're deleted. Only the files you save are
kept.

| What | Default location |
| --- | --- |
| Settings (`settings.json`) | `~/Library/Application Support/Screenshot X/` (always) |
| Captures (with their thumbnails in `Captures/.thumbnails/`) | `~/Library/Application Support/Screenshot X/Captures/` |
| Logs | `~/Library/Application Support/Screenshot X/Logs/app.log` |
| Temporary files (recording segments, previews, exports in progress) | `$TMPDIR/Screenshot X/` |
| Saved screenshots and recordings | Your **Export location** (default: `~/Downloads`) |

You can move the data folder (`Captures/` and `Logs/`) in **Settings → Advanced → Storage location**.
Existing files are moved with it, and **Reset** returns to the default. Settings always stay in the default
folder, because they record where the data folder is.

### Retention

- A capture is kept while it's in **Quick Access**, pinned, or open in an editor.
- Once nothing uses it, it's deleted after the **Keep captures** delay (Settings → Advanced). Images and videos
  have separate delays, from 1 minute to 1 hour, **5 minutes by default**. Until then you can bring it back
  from Capture History or with Restore Recently Closed.
- **Quitting Screenshot X deletes every capture** and temporary file. So does launching it, in case it didn't
  quit cleanly.
- Saving moves the capture to your export location. Screenshot X never deletes files there.

See [docs/storage.md](docs/storage.md) for the details.

## Documentation

- [Features](docs/features.md): every capture mode, Quick Access, the editor, pins, recording and the
  video editor, with their keyboard shortcuts.
- [Settings](docs/settings.md): what each settings tab controls.
- [URL scheme](docs/url-scheme.md): automate Screenshot X with `screenshotx://` links.
- [Storage and retention](docs/storage.md): where captures live, when they're deleted, and moving the data
  folder.
- [Development](docs/development.md): architecture, debugging, the browser preview and known pitfalls.
