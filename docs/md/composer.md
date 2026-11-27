# Composer

Open from the tray. Three panes: layers, canvas, inspector.

- Drag slots on the letterboxed canvas. Snap and grid (thirds, center, safe) are composer-only; OBS does not draw them.
- Pick a file (copied into `media/`) and/or write a `{placeholder}` text template.
- Playback: once or loop. Optional max `duration_ms`. Volume 0–100 for video/audio.
- Eye toggles `enabled`. Disabled slots 404 on fire.
- **Test** hits the same trigger URL as production. Copy that URL into Streamer.bot.
- Save of position happens on pointer up, not while dragging.
