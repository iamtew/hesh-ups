# Composer

Open from the tray (WebView or system browser). Three panes: layers, canvas, inspector. File menu → **Settings** (or the OBS pill) for OBS and Run at login.

The stage is a **plot**: named dashed boxes for where popups live. It is not the stream picture.

- Click a layer or box to **preview** that graphic (sample `{user}` → Ada, same as **Test**). Select a group to preview the whole group.
- **Test** takes it to **program** (same fire URL as Streamer.bot). Green mark = on air. **Hide** / duration / clip end takes it down. The plot box stays unless you deselect.
- Tray **Overlay preview** and the OBS Browser Source are program only: empty until fire. Grid, handles, names, and GROUP tags are composer chrome — never drawn in OBS.

- Each slot is one type: **text**, **image**, **gif**, **video**, **audio**, or **group**. The inspector only shows knobs for that type.
- **+** adds a text slot. Type is the first inspector control. Text gets a template plus a theme (plain or glass). Media types get a file; video/audio also get playback and volume.
- A **group** is a box. Add members inside it (positions relative to the group). Fire/hide/copy URL is the group id; members are not their own triggers. Duration lives on the group. Composer chrome only: group boxes are dashed cyan with a GROUP tag; members are lime dashed with IN {group}; the inspector banner says Group or In group (click to select the parent). Overlay/OBS does not draw that chrome.
- Drag slots on the letterboxed canvas. Snap and grid (thirds, center, safe) are composer-only; OBS does not draw them.
- Playback: once or loop (video/audio). Optional max `duration_ms` on the fireable slot. Blank or 0 is sticky until **Hide** / **Hide all**. New slots default to 5000 ms so Test does not stick forever. A green mark shows a slot that is on screen.
- Eye toggles `enabled`. Off hides that box on the stage (group eye hides every member) and 404s fire. A disabled member is also skipped when the group fires. The row stays in the list, dimmed.
- **Test** hits the same trigger URL as production. **Hide** next to it. Copy that URL into Streamer.bot.
- Save of position happens on pointer up, not while dragging. Inspector x/y/w/h/z update the box while typing; `text_template` and theme update the stage; `label` updates the layer list. PUT on change/blur.
- Scene switch and Hide all are on the top bar. OBS host/password/Browser Source live in Settings, not the slot inspector.
