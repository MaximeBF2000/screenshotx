# Storage and retention

Screenshot X keeps everything on your Mac, and its captures are **ephemeral**. A capture exists while you use
it (in Quick Access, as a pin, or in an editor). Once you stop using it, it is deleted a few minutes later, and
every capture is deleted when the app quits. Files you **save** are yours and are never deleted.

## Folders

### Settings folder (fixed)
`~/Library/Application Support/Screenshot X/settings.json` holds all settings, including the storage
location below. It never moves, because the app reads the storage location from it at launch.

### Data folder (configurable)
Default: `~/Library/Application Support/Screenshot X/`.

| Entry | Contents |
| --- | --- |
| `Captures/` | Every capture that hasn't been deleted yet: screenshots, recordings, GIFs |
| `Captures/.thumbnails/` | Small previews used by Quick Access and Capture History |
| `Logs/app.log` | App logs, including JavaScript errors from every window |

### Temporary folder
`$TMPDIR/Screenshot X/` (macOS's per-user temp folder, under `/var/folders/…`): recording segments
before they're joined, scrolling-capture previews, video filmstrips, exports in progress and the wallpaper
cache.

### Your files
Save writes to the **Export location** (Settings → General, default `~/Downloads`) or wherever you choose with
Save As. Saving moves the capture out of `Captures/`, and Screenshot X never deletes or changes files there.

## Retention

| What | Deleted when |
| --- | --- |
| A capture in use (Quick Access card, pin, open editor or Video Editor) | Never while in use |
| A capture nothing uses | After **Keep captures** (Settings → Advanced): images and videos have separate delays, 1 minute to 1 hour, **5 minutes by default**. The delay starts when the capture stops being used |
| Every capture and temporary file | When Screenshot X quits, and again at launch (in case it didn't quit cleanly) |
| Thumbnails | Together with their capture |
| Saved files | Never |
| Logs | Never deleted by the app |

GIFs count as videos. The cleanup checks every 15 seconds and never deletes early, so a capture goes between
the delay and 30 seconds after it.

### Capture History
Capture History lists the captures that still exist: the ones in Quick Access, the ones you closed less than
"Keep captures" ago, and the ones you saved (until the app quits). It's kept in memory, not on disk. Use it, or
**Restore Recently Closed**, to bring back a capture you closed by mistake before it expires.

"Move to Trash" in Quick Access moves the capture to the macOS Trash. "Clear History…" deletes the captures you
haven't saved and leaves saved files alone.

## Changing the data folder

**Settings → Advanced → Storage location**:
- **Choose…** picks a new folder. `Captures/` and `Logs/` are moved there (copied then deleted when the new
  folder is on another volume), and open Quick Access cards, pins and history entries switch to the new paths.
  If the new folder already holds a Screenshot X data folder, the folders are merged and files already there
  are kept.
- **Open** shows the current folder in Finder.
- **Reset** moves the data back to the default folder.

The chosen path is stored as `storageLocation` in `settings.json`. An empty value means the default. Edit it by
hand only while the app is not running, and move the folders yourself if you do.

The new folder must be writable, and it can't be inside the current `Captures/` or `Logs/` folders.
