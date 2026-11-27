# Composer

Open from the tray (WebView or system browser). Three panes: layers, canvas, inspector. File menu → **Settings** (or the OBS pill) for OBS and Run at login.

- Drag slots on the letterboxed canvas. Snap and grid (thirds, center, safe) are composer-only; OBS does not draw them.
- Pick a file (copied into `media/`) and/or write a `{placeholder}` text template.
- Playback: once or loop. Optional max `duration_ms`. Blank or 0 is sticky until **Hide** / **Hide all**. New slots default to 5000 ms so Test does not stick forever. A green mark shows a slot that is on screen.
- Eye toggles `enabled`. Disabled slots 404 on fire.
- **Test** hits the same trigger URL as production. **Hide** next to it. Copy that URL into Streamer.bot.
- Save of position happens on pointer up, not while dragging. Inspector x/y/w/h/z/label update the box while typing; PUT on change/blur.
- Scene switch and Hide all are on the top bar. OBS host/password/Browser Source live in Settings, not the slot inspector.
