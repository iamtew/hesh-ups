# Composer

Open from the tray (WebView or system browser). Three panes: layers, canvas, inspector. File menu → **Settings** (or the OBS pill) for OBS and Run at login.

The stage is WYSIWYG: media and sample-filled text (`{user}` → Ada, same as **Test**) as on stream. Grid, handles, and layer **label** are chrome only. Tray overlay preview is the transparent OBS page.

- Drag slots on the letterboxed canvas. Snap and grid (thirds, center, safe) are composer-only; OBS does not draw them.
- Pick a file (copied into `media/`) and/or write a `{placeholder}` text template. The stage shows that text; **label** is the name in the layer list.
- Playback: once or loop. Optional max `duration_ms`. Blank or 0 is sticky until **Hide** / **Hide all**. New slots default to 5000 ms so Test does not stick forever. A green mark shows a slot that is on screen.
- Eye toggles `enabled`. Disabled slots 404 on fire.
- **Test** hits the same trigger URL as production. **Hide** next to it. Copy that URL into Streamer.bot.
- Save of position happens on pointer up, not while dragging. Inspector x/y/w/h/z update the box while typing; `text_template` updates the stage; `label` updates the layer list. PUT on change/blur.
- Scene switch and Hide all are on the top bar. OBS host/password/Browser Source live in Settings, not the slot inspector.
