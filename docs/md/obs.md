# OBS

obs-websocket v5 on `127.0.0.1:4455` (password in Composer settings). The app reconnects in the background.

**Create/update Browser Source** from Composer or `POST /api/obs/browser-source`. That attaches to the current program scene. Add the same source to other scenes in OBS if you need it there.

Scene switch: Composer picker or `GET|POST /api/obs/scene/{name}`. Not tied to popup fire.

Enable the websocket server in OBS. If the named source already exists as a different kind, hesh-ups will not overwrite it.
