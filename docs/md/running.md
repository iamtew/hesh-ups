# Running

Install the zip or MSI (`hesh-ups.exe` only). First run creates `%APPDATA%\hesh-ups\` (SQLite, log, `media/`).

Systray:

- Composer — plot of named boxes (`/composer/`); Open window (WebView) or Open in browser
- Triggers — fire/stop every top-level slot and copy trigger URLs (`/triggers/`); Open window (WebView) or Open in browser
- Overlay preview — enabled slots on `/overlay/?preview=1` (sample Ada, muted; a live fire replaces that sample). OBS stays `/overlay/` with no query. Open window or Open in browser
- OBS connected / disconnected
- Run at login
- Open data folder
- Exit

Add **one** Browser Source named `hesh-ups` (Composer can create it): URL `http://127.0.0.1:18745/overlay/`, size = canvas (default 1920×1080), Control audio via OBS on. Bind is localhost. Port `18745`.
