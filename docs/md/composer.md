# Composer

Open from the tray (WebView or system browser). Three panes: layers, canvas, inspector. File menu → **Settings** (or the OBS pill) for OBS and Run at login.

The stage is WYSIWYG: media and sample-filled banners (`{user}` → Ada, same as **Test**) as on stream. Grid, handles, and layer **label** are chrome only. Tray overlay preview is the transparent OBS page.

- Each slot is one type: **text**, **image**, **gif**, **video**, **audio**, or **group**. The inspector only shows knobs for that type.
- **+** adds a text slot. Type is the first inspector control. Text gets a template plus a theme (plain or glass). Media types get a file; video/audio also get playback and volume.
- A **group** is a box. Add members inside it (positions relative to the group). Fire/hide/copy URL is the group id; members are not their own triggers. Duration lives on the group. Composer chrome only: group boxes are dashed cyan with a GROUP tag; members are lime dashed with IN {group}; the inspector banner says Group or In group (click to select the parent). Overlay/OBS does not draw that chrome.
- Drag slots on the letterboxed canvas. Snap and grid (thirds, center, safe) are composer-only; OBS does not draw them.
- Playback: once or loop (video/audio). Optional max `duration_ms` on the fireable slot. Blank or 0 is sticky until **Hide** / **Hide all**. New slots default to 5000 ms so Test does not stick forever. A green mark shows a slot that is on screen.
- Eye toggles `enabled`. Disabled slots 404 on fire. A disabled group member is skipped when the group fires.
- **Test** hits the same trigger URL as production. **Hide** next to it. Copy that URL into Streamer.bot.
- Save of position happens on pointer up, not while dragging. Inspector x/y/w/h/z update the box while typing; `text_template` and theme update the stage; `label` updates the layer list. PUT on change/blur.
- Scene switch and Hide all are on the top bar. OBS host/password/Browser Source live in Settings, not the slot inspector.
