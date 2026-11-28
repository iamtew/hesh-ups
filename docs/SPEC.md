# hesh-ups — Hesh Ups, the heshest popups

Dynamic popup overlay for OBS. One operator, one Windows box, localhost.

This document **is** the product. Seed the Go repo from it and ship that. Do not invent a second app (Twitch parser, TTS, StreamElements clone). Do not leave “v1 later” holes in this file.

## Goal

A systray Go app that:

- Serves a transparent overlay page for an OBS Browser Source.
- Lets the operator place **named slots** on a canvas (composer in WebView).
- Each slot is **one kind**: text, image, gif, video, audio, or a **group** of those. Fire fills `{placeholders}` on text from the trigger query/JSON.
- Fires and hides those slots over HTTP (Streamer.bot, browser, Clanker tests).
- Pushes show/hide to the overlay over **WebSocket**.
- Talks to **obs-websocket v5**: connect, status, reconnect, create/update the Browser Source, switch scenes.

A slot hides on explicit hide, on `duration_ms` (max wall-clock), or — play-once video/audio with no duration — when the file ends.

## Jobs

hesh-ups is a **named, laid-out overlay**. Streamer.bot (or anything that can hit a URL) is the brain. These are the outcomes; HTTP is how we prove them.

| Who | Job |
| --- | --- |
| Operator | Lay out a 1080 (or custom) overlay once in a WYSIWYG composer: drag slots, pick a **type**, pick files or write a text template and theme, group media with text in a container, set play-once or loop, optional max duration. The stage shows media and sample-filled banners as OBS will. |
| Operator | Copy one trigger URL per top-level slot (group members are not fireable) and paste it into Streamer.bot / Stream Deck HTTP / a browser. |
| Operator | Preview the same overlay in a WebView without guessing what OBS will show. |
| Operator | Test-fire a slot from the composer (same URL as production), including sample `{user}` text. |
| Operator | Add **one** transparent Browser Source the size of the canvas and be done. Audio is routed into OBS (`reroute_audio`). |
| Viewer | When the URL is hit, that slot (or group) **appears on stream** at its position. |
| Viewer | Play-once: the clip/sound runs **once**. Loop: it **repeats until hide or max duration**. |
| Viewer | Spam the same URL: the slot **restarts** (no stacked copies of one slot). Other slots can show at the same time. |
| Operator | Hide a slot or hide all when the bit is over. Optional: switch an OBS scene from composer or HTTP. |

Not a job: parse Twitch, TTS, goals, chat boxes. Those stay in the brain.

## Out of product (different apps)

- Linux / macOS.
- Twitch, Stream Deck, or Streamer.bot **plugins** (HTTP URLs are the integration).
- Parsing chat, TTS, donations, goals, chat boxes.
- Driving OBS Media Sources (sound/video play in the HTML overlay).
- OBS hotkeys / vendor requests to fire popups.
- Auto show/hide of the overlay Browser Source when a popup fires.
- Multi-user, cloud, HTML skins on disk, multiple overlay layouts, macros (Streamer.bot can sequence URLs).

## Surfaces

| Surface | What |
| --- | --- |
| Systray | Exit; composer and overlay preview (WebView or system browser); OBS connected/disconnected. Menu items use vendored Tabler icons (`.ico`). |
| Overlay page | `GET /overlay/` — transparent SPA, 100% canvas, **embedded in the exe**. |
| Composer | `GET /composer/` — WYSIWYG stage + OBS. Same embed. |
| HTTP API | Fire/hide, state, health, scenes. Bind `127.0.0.1`. |
| Overlay WebSocket | `GET /ws` (upgrade) — server pushes events to overlay clients. |
| obs-websocket client | JSON to local OBS. |

Tray **Open window** uses WebView. **Open in browser** uses the system browser on the same URLs.

## Defaults

| Thing | Value |
| --- | --- |
| Bind | `127.0.0.1` |
| Port | `18745` |
| Canvas | `1920x1080` |
| Token | empty = off |
| DB | `%APPDATA%\hesh-ups\hesh-ups.sqlite` |
| DB override | env `HESH_UPS_DB` (tests: temp file) |
| Assets dir | next to the DB file, folder `media/` |
| Overlay URL | `http://127.0.0.1:{port}/overlay/` |
| OBS ws | `127.0.0.1:4455`, password from settings |
| Browser source name | `hesh-ups` |
| Animations | CSS fade in/out only |
| Driver | `database/sql` + `modernc.org/sqlite` (no gcc) |
| SQLite | WAL on; schema version in `settings` |

### Stack (pinned)

Stdlib `net/http`, `database/sql`, `embed`. No ORM. No extra HTTP framework. No npm in `web/`.

| Job | Module |
| --- | --- |
| SQLite | `modernc.org/sqlite` |
| Overlay + OBS WebSocket | `github.com/coder/websocket` (OBS talks JSON on that conn; no obs-websocket helper lib) |
| Systray | `github.com/getlantern/systray` |
| Composer/preview window | `github.com/jchv/go-webview2` (WebView2 on Windows, no gcc) |

Just for build/test. Do not add a second WS lib or a Wails/Fyne shell.

HTTP server and OBS client run on goroutines. **`systray.Run` is `main()`.** WebView windows open from tray callbacks on that same thread. If WebView2 is missing: a native error dialog, then exit. Do not hang.

Log: append `%APPDATA%\hesh-ups\hesh-ups.log` (or next to `HESH_UPS_DB`). Rotate at 2 MiB, keep one `.log.1`. Stderr still gets bind failures.

---

## Errors

Every error JSON is:

```json
{"error": "unknown_slot", "message": "unknown slot"}
```

| `error` | HTTP |
| --- | --- |
| `unknown_slot` | 404 |
| `invalid_slot` / `reserved_id` / `empty_slot` / `bad_media` / `too_large` | 400 |
| `unauthorized` | 401 |
| `input_wrong_kind` | 409 |
| `obs_disconnected` / `no_scenes` | 503 |
| `port_busy` | process exits 1 (no HTTP) |

---

## Persistence (SQLite)

One file. Media stays on disk; DB stores paths. Composer save is SQL upserts. Server reads SQLite; there is no “reload JSON”.

Visible slot state is process memory **and** a small `visible` table so **sticky** slots (no duration) survive process restart. Overlay reconnects still get a WebSocket snapshot. Timed popups are not restored (they would already have ended).

### Schema version

`settings` key `schema_version` = `2`. Empty file: create tables and write defaults. On open: if version lower, migrate; if higher, refuse to start. Schema 2 adds `parent_id` and `theme`, and rewrites `media_kind=none` → `text`.

### `settings` (kv)

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Keys:

| key | meaning |
| --- | --- |
| `schema_version` | integer as text |
| `bind` | default `127.0.0.1` |
| `port` | default `18745` |
| `token` | shared secret; empty = off |
| `canvas_w` / `canvas_h` | overlay pixels |
| `obs_host` / `obs_port` / `obs_password` | obs-websocket v5 |
| `obs_browser_source` | source name to create/update |
| `last_scene` | last scene switched to (may be empty) |
| `composer_grid` | comma list `thirds,center,safe` or `off` |
| `composer_snap` | `1` / `0` |
| `autostart` | `1` / `0` — HKCU Run `hesh-ups` → exe path |

`obs_password` and `token` are stored in this file in the clear. Localhost operator box; do not copy the DB around.

### `slots`

```sql
CREATE TABLE slots (
  id            TEXT PRIMARY KEY, -- URL slug, [a-z0-9-]+
  label         TEXT NOT NULL,
  x             INTEGER NOT NULL,
  y             INTEGER NOT NULL,
  w             INTEGER NOT NULL,
  h             INTEGER NOT NULL,
  z             INTEGER NOT NULL DEFAULT 0,
  media_kind    TEXT NOT NULL,    -- text | image | gif | video | audio | group
  media_path    TEXT NOT NULL DEFAULT '', -- relative to media/; empty for text/group
  text_template TEXT NOT NULL DEFAULT '', -- `{name}` placeholders; text kind only
  playback      TEXT NOT NULL DEFAULT 'once', -- once | loop
  duration_ms   INTEGER,          -- NULL = no wall-clock cap (see playback); lives on the fireable slot (group, not children)
  volume        INTEGER NOT NULL DEFAULT 100, -- 0–100, video/audio element
  enabled       INTEGER NOT NULL DEFAULT 1, -- 0 = layer eye off; fire is 404
  css_class     TEXT,             -- leftover column; API ignores it
  parent_id     TEXT NOT NULL DEFAULT '', -- child of a group; empty = top-level
  theme         TEXT NOT NULL DEFAULT 'plain' -- text kind: plain | lcd-glass | sesh-glass | sesh-glass-old | 3026-d3c0
);
```

`id` is the trigger name. Must match `[a-z0-9-]+`. Reserved: `hide_all` (the hide-all route). Several top-level slots may show at once. They may overlap; higher `z` is on top.

Kinds are **exclusive**. `text` needs a non-empty `text_template`. `image`/`gif`/`video`/`audio` need a non-empty `media_path`. `group` is a container: children have `parent_id` set to the group id; child `x,y` are relative to the group box. Nested groups are rejected. Empty group may be saved; **fire** of an empty group → `400` `empty_slot`. Child fire URL → `404` `unknown_slot`. Composer copies picked files into `media/` and stores a path relative to that folder. `GET /media/...` only serves files under `media/` (reject `..` and absolute paths).

### Slot playback and hide

Two knobs, independent:

| `playback` | Media |
| --- | --- |
| `once` | Video/audio: play from the start, do not loop. Image/text: shown. Animated gif: the file loops on its own; we do not restitch frames. |
| `loop` | Video/audio: HTML `loop` until the slot hides. Image: no-op. Gif: same as once (file loops). |

| Hide when | |
| --- | --- |
| `hide` / `hide_all` | Always. |
| `duration_ms` set | Wall-clock max from this fire (request may override). Loop-for-8s = `loop` + `duration_ms=8000`. |
| `playback=once`, video/audio, `duration_ms` null | Overlay sends `ended`; server hides. |
| `playback=once`, video/audio, `duration_ms` set | Hide at duration even if the file is longer (cut). If the file ends first, **hold last frame / silence** until duration (do not loop). |
| Image/gif/text, `duration_ms` null or `<= 0` | Sticky until hide. Zero is not a timer. |
| Group, `duration_ms` set | Hide the whole group at that wall-clock. |
| Group, `duration_ms` null, only play-once video/audio children (no `loop`) | Overlay sends `ended` on the **group** id when the last once-media ends; server hides. |
| Group, `duration_ms` null, no once-media or any child `loop` | Sticky until hide. |

Retrigger while visible: restart media from the start, re-render text, restart the duration timer.

Text: server replaces `{identifier}` with vars from the fire (`[A-Za-z_][A-Za-z0-9_]*`). Missing key → empty string. No conditionals. Rendered string is HTML-escaped before it hits the overlay. Common names: `{user}`, `{amount}`, `{message}` — not special, just conventional query keys.

### `event_log`

Append-only. Feeds `/api/state` and Clanker checks. After insert, prune to last **500** rows.

```sql
CREATE TABLE event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,           -- RFC3339 nano UTC
  action     TEXT NOT NULL,           -- show | hide | hide_all | scene
  slot_id    TEXT,                    -- nullable for hide_all / scene
  detail     TEXT NOT NULL DEFAULT '',-- e.g. scene name, duration override
  result     TEXT NOT NULL            -- ok | error:...
);
```

### `visible` (sticky restore)

```sql
CREATE TABLE visible (
  slot_id TEXT PRIMARY KEY,
  seq     INTEGER NOT NULL,
  text    TEXT NOT NULL DEFAULT '',
  media_kind TEXT NOT NULL,
  media_path TEXT NOT NULL DEFAULT ''
);
```

On **show** of a slot with no effective duration: upsert this row. On hide / hide_all / duration hide / `ended`: delete. On process start: load rows, put them in memory, so the first overlay snapshot restores those stickies. Timed fires never write here.

Media library is the `media/` directory (`GET /api/media` lists it). No extra table.

---

## Runtime

1. Open SQLite (`HESH_UPS_DB` or default path). Create/migrate. Ensure `media/` exists.
2. Listen `bind:port`. If bind fails (port in use or permission): log the error to stderr and `os.Exit(1)`. That is the single-instance rule — no mutex, no second socket. Tests MUST NOT call `Listen`; they use `httptest` on the handler.
3. Connect obs-websocket in the background; reconnect with backoff. Tray/composer show connected or not. Tests MUST NOT start systray or WebView.
4. Overlay clients subscribe to `/ws`. On connect: send `config` (canvas + all slots) then `snapshot` (currently visible).
5. Fire: reject if `enabled=0` (`404` `unknown_slot` — URL dead while the eye is off). Merge vars, render text, bump `seq`, mark visible, log, broadcast `show` (include `volume`). Duration timer if set. Retrigger restarts media, text, `seq`, timer. Persist/delete `visible` per table rules. Hide / hide_all / duration / matching `ended` clear memory, `visible` row, and broadcast.
6. Overlay sends `{"type":"ended","slot":"logo","seq":3}` when play-once video/audio finishes. Server hides only if that slot is visible and `seq` matches the last fire.

Assets: files under `media/`, served at `GET /media/...`.

---

## HTTP API

All JSON responses are objects. Unknown slot → `404` `{"error":"unknown_slot","message":"unknown slot"}`.

If `token` is non-empty, fire/hide/hide_all and scene-switch require `Authorization: Bearer <token>` **or** query `?token=`. That is the URL you paste into other software. Health, state, slot CRUD, settings, overlay, `/ws`, `/media/`, `/composer` do not (bind is localhost; WebView is not an auth client). Empty token = all open on localhost.

GET and POST are both accepted on fire/hide/hide_all/scene so Streamer.bot “open URL” works.

### Health and state

`GET /api/health`

```json
{"ok": true, "db": true, "obs": false, "port": 18745, "version": "0.0.1"}
```

`"ok"` is false if the DB is not usable. OBS down does not fail health.

`GET /api/state`

```json
{
  "canvas": {"w": 1920, "h": 1080},
  "obs": {"connected": false, "scenes": [], "current_scene": ""},
  "slots": [
    {
      "id": "logo",
      "label": "Logo",
      "x": 100, "y": 40, "w": 320, "h": 180, "z": 1,
      "media_kind": "image",
      "media_path": "logo.png",
      "text_template": "",
      "playback": "once",
      "duration_ms": null,
      "volume": 100,
      "enabled": true,
      "parent_id": "",
      "theme": "plain",
      "visible": false,
      "text": ""
    }
  ],
  "events": [
    {
      "id": 1,
      "ts": "2026-11-27T01:00:00.0000000Z",
      "action": "show",
      "slot_id": "logo",
      "detail": "",
      "result": "ok"
    }
  ]
}
```

`slots` from DB plus `visible` and last rendered `text` from memory. `events` = last 50 `event_log` rows, newest first. `obs.scenes` empty if disconnected.

### Popups

`GET|POST /api/popup/{id}`  
`GET|POST /api/popup/{id}/hide`  
`GET|POST /api/popup/hide_all`

Fire query (all optional):

- `duration_ms` — override slot duration for this show (`0` = no wall-clock cap this time).
- `token` — if settings token is set.
- any other key — template vars (`user`, `amount`, `message`, …). Reserved: `duration_ms`, `token`.

POST JSON optional. Merge order (later wins): query string → JSON object keys → JSON `vars` object if present. Ignore reserved keys `duration_ms`, `token`, `vars` as template vars.

Responses: `{"ok": true, "id": "follow", "visible": true, "text": "Thanks Ada!"}` or 404.

Example: `GET /api/popup/follow?user=Ada&amount=1` with template `Thanks {user}!` → overlay text `Thanks Ada!`.

### Composer CRUD

`GET /api/slots` — all slots (no visible flag required; `/api/state` is the live view).

`PUT /api/slots/{id}` — upsert one slot (JSON body = columns; if body has `id` it must match the URL). Invalid slug, reserved id, `media_kind`, `playback`, `theme`, bad `parent_id`, or empty payload for that kind → `400`.

`DELETE /api/slots/{id}` — remove slot; if visible, hide first. Deleting a group also deletes its children.

`GET /api/media` — `{"files":[{"path":"logo.png","kind":"image"}]}` from the `media/` directory (no table).

`POST /api/media` — `multipart/form-data`, field name `file`. Max **32 MiB**. Save under `media/` using the basename, sanitized to `[A-Za-z0-9._-]+` (reject `..`). Extension → `kind`: `png|jpg|jpeg|webp` → `image`; `gif` → `gif`; `mp4|webm` → `video`; `mp3|wav|ogg` → `audio`; else `400` `bad_media`. Too big → `too_large`. Response `{"path":"logo.png","kind":"image"}`. Collision: if the name exists, append `-` + short random suffix before the extension. Composer file pick uses this, then `PUT` the slot with that `path` and `kind`. Inspector can also pick an existing `path` from `GET /api/media`.

`GET /api/settings` — kv map of the keys above except `schema_version`. Composer settings modal uses this.

`PUT /api/settings` — upsert the kv keys listed above (JSON object of key → value). Port/bind change applies on **next process start** (response says so).

`POST /api/quit` — 204; close WebView windows then tray `systray.Quit`. Tests set callbacks and MUST NOT start the tray.

`POST /api/view/close` — 204; Terminate composer/overlay WebViews if open. Browser tabs still `window.close()`.

`POST /api/help` — 204; open Pages `docs.html#composer` in the system browser. Tests stub; MUST NOT `exec`.

### OBS

`POST /api/obs/browser-source` — create or update the Browser Source named in settings `obs_browser_source` (default `hesh-ups`): overlay URL, width/height = canvas, shutdown-on-hide off, audio allowed. If OBS disconnected → `503`.

`GET /api/obs/scenes` — `{ "connected": true, "scenes": ["Cam", "BRB"], "current_scene": "Cam" }`

`GET|POST /api/obs/scene/{name}` — switch scene (`name` URL-encoded); log `action=scene`. Unknown scene or disconnected → `404` / `503`.

---

## Overlay WebSocket

URL: `ws://127.0.0.1:{port}/ws`

Overlay → server:

```json
{"type": "ping"}
{"type": "ended", "slot": "clip", "seq": 3}
```

`ping` → `{"type":"pong"}`. `ended` is for `playback=once` video/audio `ended` events only.

Server → overlay:

```json
{"type": "config", "canvas": {"w": 1920, "h": 1080}, "slots": [ /* slot rows without visible/text */ ]}
{"type": "snapshot", "visible": [{"id": "follow", "seq": 1, "media_kind": "text", "media_url": "", "playback": "once", "text": "Thanks Ada!", "theme": "plain", "duration_ms": 5000}]}
{"type": "show", "slot": "follow", "seq": 1, "media_kind": "text", "media_url": "", "playback": "once", "volume": 100, "text": "Thanks Ada!", "theme": "lcd-glass", "duration_ms": 5000}
{"type": "hide", "slot": "follow"}
{"type": "clear"}
```

`media_url` is `""` when `media_kind` is `text` or `group`. `text` is already rendered and HTML-escaped. `theme` is the text banner id (`plain` = stroke text, no Pixi). Group `show` includes `members` (relative `x,y,w,h`, per-child media/text/theme). `seq` is a per-slot integer. First fire is `1`; each new fire adds one. Restart of the process starts at `1` again. Group `ended` uses the group id and group `seq`.

- `config` on connect and after slot or canvas save.
- `snapshot` on connect: enough to redraw visible slots (seq, media, rendered text).
- Live: `show` / `hide` / `clear` (hide_all).
- Overlay hides on `hide` / `clear` only. It reports `ended`; the server decides and broadcasts `hide`.

Overlay DOM: one node per **top-level** slot, class `slot popup`, positioned with `x,y,w,h`, `z-index`. Hidden = not shown. Background transparent. Body fills the canvas. Image/gif = `<img>`. Video = `<video autoplay>` with `loop` only if `playback=loop`, `volume` = slot `volume/100`. Audio = `<audio autoplay>` same `loop` and `volume`. Text = `.banner-content` (`.theme-panel` when theme ≠ `plain`) wrapping escaped `.banner-text`; `data-theme` on `.popup`; Pixi `start`/`stop` from embedded `SeshThemes`. Group = the group box with member `.popup` children at relative coords. Fade CSS ~200ms. Shared CSS/JS at `/shared/` (banner shell, themes, vendored Pixi). No disk skins.

---

## Composer

Page `/composer/`. Files: `web/composer/index.html`, `style.css`, `app.js`, plus `/shared/` (banner + themes + Pixi). Vanilla. **No npm, no bundler, no interact.js.** Pointer events in `app.js`.

Look: **house designer chrome** (same as Border Studio / Show Credits), not a website. Cyan selection (`#00ffff`), not Border Studio lime.

- Tokens on `body.admin`: `--shell #282828`, `--panel #222`, `--lift #3b3b3b`, `--line #4a4a4a`, `--text #e6e6e6`, `--muted #9a9a9a`, `--accent #00ffff`, `--accent2 #88f25d`, `--r 3px`.
- Segoe UI. `color-scheme: dark`. Full viewport, `overflow: hidden` on `body`. WebView opens large (~1280×800).

### Chrome (three panes + top bar)

```
[ top bar ]
[ layers | canvas (flex) | inspector ]
```

**Top bar:** brand **file menu** (Settings, Help → `POST /api/help`, Close → `POST /api/view/close`, Quit, version); canvas 720p / 1080p (writes `canvas_w/h`); grid toggles (thirds, center, safe — composer-only, not drawn in OBS); Snap (default on); copy overlay URL; **Hide all**; OBS scene `<select>` + Switch; OBS pill (red/green dot). Pill click opens Settings on OBS. Status line for copy/fire/hide/errors.

**Settings** is a blur modal with left nav, not a workspace tab. **OBS:** host, port, password, Browser Source name, status, create/update Browser Source. Save on close (`PUT /api/settings`); writing `obs_*` kicks the websocket so a new password is used immediately. **App:** Run at login, fire token. No Connect/Disconnect UI — background reconnect.

**Layers (left ~240px):** slot list, front = high `z`. Group children indent under the group. Click selects. Eye toggles `enabled`. **+** adds a top-level **text** slot (`id` `slot-n`, `theme` `plain`, `text_template` `New slot`, **`duration_ms` 5000**). Trash deletes (`DELETE`; group deletes children). Empty canvas: one hint, no fake sample slot. No jb2 visualizers. Text themes are the embedded banner set, not disk skins.

**Canvas (center):** letterboxed 16:9 of `canvas_w`×`canvas_h`. **WYSIWYG** of overlay slot content (image/gif/video + filled `text_template`; `{user}` sample is `Ada`, same as Test). Grid, cyan handles, layer `label`, group fill/tags (`GROUP` / `IN {group}`), and inspector group banner are composer chrome — not drawn in OBS. Tray overlay preview stays the transparent OBS page. Pointer math in **canvas pixels**. Framing grid is SVG on the composer only. Selected box: cyan outline, eight handles (n/s/e/w/nw/ne/sw/se). Drag move; handles resize. Min size 32×32. Clamp to canvas. Snap 12px to grid lines and to other slot edges/centers when Snap is on. While dragging, update the inspector numbers live; **`PUT /api/slots/{id}` on pointerup** (not per mousemove). Overlay in OBS does not need live follow during drag.

**Inspector (right ~280px):** slot only — id, **label**, x y w h z (typing updates the box live; **`PUT` on change/blur** / pointerup). **type** first (`text` / `image` / `gif` / `video` / `audio` / `group`). Only knobs for that kind: text → template + theme; image/gif → file; video/audio → file + playback + volume; group → member list + Add member. Duration on the fireable slot (not on children). **Test** / **Hide** / copy trigger URL use the group id for members. Trash. Empty selection: “Select a slot”. OBS credentials and autostart live in Settings, not here. Id rename still needs Save (warns).

If `/api/state` polling fails, a full-window down banner: application not running.

Changing id on save = new slot (old URL 404s). Warn.

Overlay page: vanilla `web/overlay/index.html` (+ css/js). No frameworks. Transparent; not this chrome.

---

## OBS (obs-websocket v5)

OBS is a JSON WebSocket at `ws://{obs_host}:{obs_port}` (default `127.0.0.1:4455`). Same `coder/websocket` as the overlay hub. **No** third-party OBS client library.

**CreateInput** is the v5 request that *creates a source and puts it on a scene*. The “field dump” is `requestData.inputSettings`: the same keys OBS shows in a Browser Source’s properties. We send a full dump so agents do not guess.

### Session

1. Connect. First message is Hello (`op: 0`) with `authentication` challenge if a password is set.
2. Identify (`op: 1`): `{ "rpcVersion": 1 }` plus `authentication` string per [obs-websocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#creating-an-authentication-string) when Hello included a challenge.
3. Identified (`op: 2`). Then send `op: 6` Request messages: `{ "requestType", "requestId", "requestData" }`.
4. Drop / fail Identify → mark disconnected, backoff reconnect (1s, 2s, 5s, cap 15s). Tray + composer pills follow that flag.

### Requests we use

| `requestType` | When |
| --- | --- |
| `GetSceneList` | composer scene picker; `currentProgramSceneName` + `scenes[].sceneName` |
| `SetCurrentProgramScene` | `{ "sceneName" }` — HTTP `GET\|POST /api/obs/scene/{name}` |
| `GetInputList` | find `obs_browser_source` by `inputName` |
| `CreateInput` | name missing |
| `SetInputSettings` | name exists and `inputKind` is `browser_source` |

If the name exists as a **different** kind → HTTP `409` `{"error":"input exists, not browser_source"}`. Do not overwrite a mic.

### Browser Source `inputSettings` (the dump)

Use this object for both Create and Set. `url` / `width` / `height` follow live settings (port, canvas).

```json
{
  "url": "http://127.0.0.1:18745/overlay/",
  "width": 1920,
  "height": 1080,
  "css": "body { background-color: rgba(0,0,0,0) !important; margin: 0; overflow: hidden; }",
  "shutdown": false,
  "restart_when_active": false,
  "reroute_audio": true,
  "fps": 30,
  "fps_custom": false,
  "webpage_control_level": 1
}
```

| Field | Why |
| --- | --- |
| `url` | overlay (trailing slash) |
| `width` / `height` | canvas pixels — OBS source must match or layout is wrong |
| `css` | transparent page; OBS default CSS is a white body |
| `shutdown: false` | keep the WS alive when the source is not visible |
| `restart_when_active: false` | do not reload and drop popups on scene switch |
| `reroute_audio: true` | “Control audio via OBS” so video/audio is not “silent” |
| `fps` / `fps_custom` | 30; do not invent 60 unless asked |
| `webpage_control_level` | `1` = limited (no OBS remote from the page) |

`CreateInput` `requestData`:

```json
{
  "sceneName": "<currentProgramSceneName>",
  "inputName": "hesh-ups",
  "inputKind": "browser_source",
  "sceneItemEnabled": true,
  "inputSettings": { }
}
```

`sceneName`: current program scene from `GetSceneList`. If OBS has zero scenes → `503`. `inputName` from settings `obs_browser_source`.

`SetInputSettings` `requestData`:

```json
{
  "inputName": "hesh-ups",
  "overlay": true,
  "inputSettings": { }
}
```

`overlay: true` merges; we still send the full dump.

`POST /api/obs/browser-source` runs GetInputList then Create or Set. `503` if disconnected. Operator may still need to **add the source to other scenes**; Create only attaches to the current program scene.

`SetCurrentProgramScene` is a separate action (HTTP + composer top-bar picker). Not tied to popup fire.

Not in product: OBS hotkeys, Media Sources, auto hide of this source, vendor requests.

---

## Systray

Embedded `cmd/hesh-ups/icon.ico` (from `just icon` / `assets/logo.png`) for the tray notification glyph. Exe PE icon is `rsrc_windows_amd64.syso`. Menu items set Tabler `.ico` from `cmd/hesh-ups/icons/` via `MenuItem.SetIcon`. Overlay page has no chrome icons.

- **Composer** ▸ **Open window** — WebView `http://127.0.0.1:{port}/composer/` (~1280×800); **Open in browser** — same URL in the system browser
- **Overlay preview** ▸ **Open window** — WebView `/overlay/` (1280×720 unless canvas fits); **Open in browser** — same URL in the system browser
- **OBS: connected** / **OBS: disconnected** — label
- **Run at login** — checkable; same as settings `autostart`
- **Open data folder** — Explorer on `%APPDATA%\hesh-ups`
- **Exit** — stop HTTP, close DB, quit

Tooltip: `hesh-ups` + version.

---

## Build

Windows. `just build` → one exe (overlay + composer compiled in). `just test` runs verification (below). First run creates the DB and `media/`. Packaging: [LAYOUT.md](LAYOUT.md).

---

## Verification (Clanker)

`just test` is `go test ./...` (and `go vet`). **In-process:** construct the HTTP handler, `httptest.NewServer` or `ServeHTTP` on `httptest.ResponseRecorder`. Temp dir for `HESH_UPS_DB` + `media/`. Use the same `embed.FS` as production.

MUST NOT: `exec` `hesh-ups.exe`, start systray, open WebView, or `Listen` on `:18745`. Live OBS (R11) skips when a test builds the server **without** a real OBS connection (`obs: false`).

`just test` must fail if any required case fails.

### R1 — start

**Given** a temp DB path and the handler  
**When** `GET /api/health`  
**Then** 200, `"ok": true`, `"db": true`, `"version"` set

### R2 — seed slot

**Given** health ok  
**When** `PUT /api/slots/logo` with a valid image slot (test fixture file copied into `media/`)  
**Then** `GET /api/state` lists `logo` with `visible: false`

### R3 — fire

**Given** slot `logo`  
**When** `POST /api/popup/logo`  
**Then** state has `visible: true` for `logo`; `events[0].action` is `show` and `result` is `ok`; a WebSocket client that connected before the fire received `type=show` and `slot=logo`

### R4 — hide

**Given** `logo` visible  
**When** `POST /api/popup/logo/hide`  
**Then** `visible: false`; latest event `hide`; WS received `type=hide`

### R5 — hide all

**Given** two visible slots  
**When** `POST /api/popup/hide_all`  
**Then** both `visible: false`; event `hide_all`; WS `type=clear`

### R6 — duration

**Given** slot with `duration_ms: 200` or fire `?duration_ms=200`  
**When** fired and 400ms pass  
**Then** `visible: false` and a `hide` event exists

### R7 — restart timer

**Given** visible slot with duration 500ms  
**When** fired again at t=300ms  
**Then** still visible at t=600ms from first fire; hidden after 500ms from second fire

### R8 — unknown slot

**When** `POST /api/popup/nope`  
**Then** 404 `{"error":"unknown_slot"}`; no show event with `result=ok`

### R9 — invalid slot id

**When** `PUT /api/slots/Not Valid`  
**Then** 400

### R10 — token

**Given** settings `token=secret`  
**When** fire without token  
**Then** 401  
**When** fire with `?token=secret`  
**Then** 200

### R11 — OBS optional

**Given** OBS not running  
**Then** health `"ok": true`, `"obs": false`; `GET /api/state` `obs.connected` is false; `POST /api/obs/browser-source` is 503

**Given** OBS running with websocket (manual / optional job)  
**Then** health `"obs": true`; `GET /api/obs/scenes` lists scenes; `POST /api/obs/scene/{existing}` returns 200 and `event_log` action `scene`

### R12 — snapshot on WS connect

**Given** `logo` visible  
**When** a new WS client connects  
**Then** it receives `config` then `snapshot` whose `visible` list includes `id` `logo`

### R13 — DB override

**Given** two temp DB files A and B  
**When** handler A is seeded with `logo`; handler B opens B empty  
**Then** B has no `logo` slot — data does not leak across DB files

### R14 — text template

**Given** slot `follow` with `text_template` `Thanks {user}!`, `media_kind` `text`  
**When** `POST /api/popup/follow?user=Ada`  
**Then** response `"text": "Thanks Ada!"`; WS `show` has the same `text`; state `visible` true

**When** `POST /api/popup/follow` with no `user`  
**Then** `"text": "Thanks !"` (missing key empty)

### R15 — reject empty slot

**When** `PUT /api/slots/empty` with `media_kind=text` and empty `text_template`  
**Then** 400

### R16 — loop max duration

**Given** slot with `playback=loop`, `duration_ms=200`  
**When** fired  
**Then** WS `show` has `"playback":"loop"`; after 400ms `visible` is false and a `hide` event exists

### R17 — play-once ended

**Given** slot `clip` with `playback=once`, `duration_ms` null, `media_kind=video`, fixture file in `media/`  
**When** fired (`show` has `seq` N), then the test WS client sends `{"type":"ended","slot":"clip","seq":N}`  
**Then** `visible` is false and WS received `hide`

**When** fired (seq N), retriggered (seq N+1), then `ended` with `seq` N arrives  
**Then** still visible (stale `ended` ignored)

**When** `ended` arrives with no `seq` or a mismatched slot  
**Then** no hide

### R18 — reserved id

**When** `PUT /api/slots/hide_all`  
**Then** 400

### R19 — media upload

**Given** the handler and a tiny PNG in the test request  
**When** `POST /api/media` multipart field `file`  
**Then** 200 `path` and `kind=image`; `GET /media/{path}` returns the bytes

**When** `POST /api/media` with `file` named `../x.png` or a `.exe`  
**Then** 400 `bad_media`

### R20 — volume on show

**Given** slot with `volume` 40  
**When** fired  
**Then** WS `show` has `"volume":40`

### R21 — sticky restore

**Given** a sticky slot (`duration_ms` null) fired and still visible  
**When** a new handler opens the **same** DB  
**Then** `/api/state` has that slot `visible: true` and a WS snapshot lists it

**Given** a slot fired with `duration_ms=200`  
**When** a new handler opens the same DB after hide  
**Then** it is not visible

### R22 — disabled slot

**Given** slot `logo` with `enabled` false  
**When** `POST /api/popup/logo`  
**Then** 404 `unknown_slot`

### R23 — error envelope

**When** `POST /api/popup/nope`  
**Then** body has both `error` and `message` keys
