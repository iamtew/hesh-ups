# HTTP

Bind `127.0.0.1:18745`. GET and POST both work on fire/hide so “open URL” clients work. Copy those URLs from the [board](board.md) (tray **Board**).

- Fire: `GET /api/popup/{id}?user=Ada` (group id fires the whole group; member ids 404)
- Hide: `/api/popup/{id}/hide`
- Hide all: `/api/popup/hide_all`

Query keys fill `{placeholders}` in the slot text (`{user}`, `{amount}`, `{message}` are conventional, not special). Optional `duration_ms`, `media` (file under `media/` for this fire), and `volume` (0–100) overrides. If settings `token` is set, fire/hide/scene need `Authorization: Bearer` or `?token=`.

Health: `GET /api/health`. Live view: `GET /api/state`.
