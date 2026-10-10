# Storage and retention

Screenshot X keeps everything on your Mac. This page lists every folder it writes to, what each one holds,
and when files are deleted.

## Folders

### Settings folder (fixed)
`~/Library/Application Support/com.screenshotx.app/`

| File | Contents |
| --- | --- |
| `settings.json` | All settings, including the storage location below |

This folder never moves: it is where the app reads the storage location from at launch.

### Data folder (configurable)
Default: the same folder, `~/Library/Application Support/com.screenshotx.app/`.

| Entry | Contents |
| --- | --- |
| `Captures/` | New screenshots and recordings that haven't been saved yet (shown in Quick Access, pins, the editor) |
| `History/<id>/` | Capture History copies: one folder per capture, hard-linked to the original when possible |
| `Thumbnails/` | JPEG thumbnails for Quick Access and Capture History |
| `history.json` | The Capture History index |

### Temporary folder
`$TMPDIR/com.screenshotx.app/` (macOS's per-user temp folder, under `/var/folders/…`): recording segments
before they're joined, scrolling-capture previews, video filmstrips, exports in progress and the wallpaper
cache.

### Logs
`~/Library/Logs/Screenshot X/app.log`. JavaScript errors from every window are written there too.

### Your files
Save writes to the **Export location** (Settings → General, default `~/Downloads`) or wherever you choose
with Save As. Screenshot X never deletes or changes files there.

## Retention

Cleanup runs when the app starts and then every 6 hours.

| What | Deleted when |
| --- | --- |
| Capture History entries (copy + thumbnail) | Older than the **Capture history** setting: 1 day, 1 week, **1 month (default)** or 3 months. With **Never**, nothing is kept and existing history is cleared |
| Unsaved captures in `Captures/` | When you close their Quick Access card. Leftovers that no Quick Access card or pin uses are deleted after 2 days |
| Saved captures | Never in `Captures/`: saving moves the file to the export location |
| Thumbnails | With their history entry, or after 2 days once no history entry or Quick Access card uses them |
| Temporary files | After 2 days |
| Logs | Never deleted by the app |

"Move to Trash" in Quick Access moves the capture to the macOS Trash instead of deleting it.

## Changing the data folder

**Settings → Advanced → Storage location**:
- **Choose…** picks a new folder. `Captures/`, `History/`, `Thumbnails/` and `history.json` are moved there
  (copied then deleted when the new folder is on another volume), and open Quick Access cards, pins and
  history entries are updated to the new paths. If the new folder already holds a previous Screenshot X data
  folder, the folders are merged and files already there are kept.
- **Open** shows the current folder in Finder.
- **Reset** moves the data back to the default folder.

The chosen path is stored as `storageLocation` in `settings.json`. An empty value means the default. Edit it
by hand only while the app is not running, and move the folders yourself if you do.

The new folder must be writable, and it can't be inside the current `Captures/` or `History/` folders.
