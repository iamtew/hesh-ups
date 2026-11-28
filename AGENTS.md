# Agent notes

Source of truth: [docs/SPEC.md](docs/SPEC.md) (behavior) and [docs/LAYOUT.md](docs/LAYOUT.md) (where files live). Do not invent a second product.

Work on `master`. Do not open a PR or a side branch unless asked.

## Ship it

When the Meat Bag says **ship it**:

- commit leftover units on `master`
- push `origin`

No force-push. No PRs for a normal ship.

## Stack

Go module `github.com/iamtew/hesh-ups`. One binary: `./cmd/hesh-ups`. Pinned deps only: `modernc.org/sqlite`, `github.com/coder/websocket`, `github.com/getlantern/systray`, `github.com/jchv/go-webview2`. Stdlib `net/http`. No ORM, no extra HTTP/WS/OBS helper, no npm in `web/`.

`systray.Run` is `main()`. `go test` starts the app `Serve` on `127.0.0.1:0` with a temp DB. No `httptest`. It MUST NOT start systray, WebView, or `Listen` on `:18745`.

A live check is only the tray already on `http://127.0.0.1:18745` (health, state, popup, overlay, triggers, `/ws`). If `GET /api/health` fails, say the tray app is not up. Do not start a second one, do not copy `%APPDATA%\hesh-ups`, do not set `HESH_UPS_DB` or `HESH_UPS_HTTP`.

No `internal/` until a second binary exists. Overlay/composer/triggers stay embedded (`//go:embed all:web`). Pages stay `docs/` on `master`.
