# URL scheme

Screenshot X can be controlled with `screenshotx://` links, for example from Raycast, Alfred, Shortcuts or a
shell (`open "screenshotx://capture-area"`). The commands match CleanShot X's API.

Enable it in **Settings → Advanced → URL scheme**, or approve the prompt shown on the first request.

## Commands

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

## Parameters
- All parameters are optional.
- `x`, `y`, `width`, `height` preset the selection, in points, with the origin at the **bottom-left** of the
  display (same as CleanShot).
- `display` is the display number (1 = main display).
- `action` overrides the "After capture" settings for that capture: `copy`, `save`, `annotate` or `pin`.
- `filepath` is an absolute path. With `capture-text`, the text is read from that image instead of the
  screen.

Debug builds also accept a few `debug-*` commands used for testing; see [development.md](development.md).
