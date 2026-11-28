# OBS

obs-websocket v5 on `127.0.0.1:4455` (password in Composer **Settings → OBS**, or click the OBS pill). The app reconnects in the background.

**Create/update Browser Source** from that Settings page or `POST /api/obs/browser-source`. That creates or updates the named source and puts it on **every scene** in the collection that does not already have it. One input; no auto show/hide.

Scene switch: Composer top-bar picker or `GET|POST /api/obs/scene/{name}`. Not tied to popup fire.

Enable the websocket server in OBS. If the named source already exists as a different kind, hesh-ups will not overwrite it.
