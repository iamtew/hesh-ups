# Running

Install the zip or MSI (`hesh-ups.exe` only). First run creates `%APPDATA%\hesh-ups\` (SQLite, log, `media/`).

Systray:

- Composer — layout WebView
- Overlay preview — same page OBS loads
- OBS connected / disconnected
- Run at login
- Open data folder
- Exit

Add **one** Browser Source named `hesh-ups` (Composer can create it): URL `http://127.0.0.1:18745/overlay/`, size = canvas (default 1920×1080), Control audio via OBS on. Bind is localhost. Port `18745`.
