# hesh-ups — repository layout specification

**Normative** for the seeded Git repository. Product behavior is [SPEC.md](SPEC.md). If this file and that file disagree about *runtime* (ports, DB path, HTTP), **SPEC.md wins**. If they disagree about *where a file lives*, **this file wins**.

The keywords MUST, MUST NOT, SHOULD, MAY are RFC 2119.

This bootstrap directory (`scratchpad/hesh-ups-bootstrap/`) is notes. It MUST NOT be the application repo. Seeding writes a new tree (for example `~/src/hesh-ups`).

---

## 1. Intent

- Small repository root. A stranger can name every top-level entry.
- All Go that ships in the exe in **one** directory, including the overlay/composer/triggers HTML (`cmd/hesh-ups/web/`).
- **`docs/` is the GitHub Pages website** (branch `master`, folder `/docs`). Operator markdown lives *inside* `docs/` so files and the site are the same pages. That GitHub pattern MUST remain.
- Dist, zip, and per-user MSI come from the root `Justfile`.

---

## 2. Why this shape (so we do not “improve” it into a mess)

| Choice | Why | Anti-pattern we are avoiding |
| --- | --- | --- |
| `cmd/hesh-ups/` | Idiomatic Go for a single binary. Import path is `…/cmd/hesh-ups`, not `…/src`. | GOPATH-era `src/`. Also avoiding `internal/` + `pkg/` + `api/` with one executable. |
| `docs/` = Pages | GitHub’s supported project site. | A second tree (`site/`, `gh-pages`, MkDocs `public/`). Root `index.html` (that is a *user* Pages site, different product). |
| App UI in `cmd/hesh-ups/web/` | Same package as `main`. `//go:embed all:web`. Dist is the exe. | Loose `webroot/` at repo root. Shipping a `web/` folder. AppData “override” skins. |
| DB in `%APPDATA%` | MSI upgrade must not delete slots. | SQLite next to the exe (jb2 does that; wrong here). |
| `VERSION` file + ldflags | WiX/Just can read a file without Git. Binary can print the same number. | Zip named `0.0.1` while `/api/health` says `dev`. |

---

## 3. Identity

| Item | Value |
| --- | --- |
| Product name | hesh-ups |
| Binary | `hesh-ups.exe` |
| Go module | `github.com/iamtew/hesh-ups` (MUST match the GitHub repo) |
| Main package | `./cmd/hesh-ups` |
| Branch | `master` |
| License | MIT (`LICENSE`) |
| Version | `VERSION` — one line, SemVer, no `v` (`0.0.1`). Git tag, zip/MSI name, and `go build -ldflags "-X main.version=<VERSION>"` MUST use that string. |
| Line endings | `.gitattributes`: `* text=auto eol=lf`. WiX `.wxs` / `.rtf` MAY be CRLF. |
| Go deps | Pinned in [SPEC.md](SPEC.md) Stack: `modernc.org/sqlite`, `github.com/coder/websocket`, `github.com/getlantern/systray`, `github.com/jchv/go-webview2`. MUST NOT add Wails, Fyne, gorilla/websocket, or an obs-websocket wrapper. |

---

## 4. Admission — repository root

**Always committed:**

```
.gitattributes
.gitignore
AGENTS.md
go.mod
go.sum
Justfile
LICENSE
README.md
VERSION
cmd/hesh-ups/
docs/
packaging/
```

**Committed when they exist (do not create empty):**

| Path | When |
| --- | --- |
| `.cursor/` | Cursor rules for this repo |
| `.editorconfig` | If editors need it beyond `.gitattributes` |
| `.github/workflows/dist.yml` | Required for a GitHub Release: `just build-dist` on tag |
| `assets/logo.png` | Product logo/icon master (square). `just icon` derives docs/composer/tray/exe copies. Never overwrite the master. |
| `assets/logo.af` | Affinity Studio source for `logo.png`. |
| `docs/md/credits.md` | Third-party notices (Pages chapter; not a root `CREDITS.md`) |

**MUST NOT:** `src/` (Go), `webroot/`, `web/`, `static/`, `public/`, `frontend/` at repo root; `internal/`, `pkg/`, `app/`, `backend/`, `site/`, `website/`, `pages/`; root `main.go`; a second `go.mod`; JUCE `Builds/`; `installer/` (WiX is `packaging/`). Extra `cmd/foo` only if there is a second binary.

**MUST gitignore / MUST NOT commit:** `dist/`, `hesh-ups.exe`, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `.env`.

Runtime DB path is SPEC.md (`%APPDATA%\hesh-ups\` or `HESH_UPS_DB`). Not a Git directory.

---

## 5. `docs/` — GitHub Pages (locked)

GitHub Pages MUST be:

- Source: **Deploy from a branch**
- Branch: `master`
- Folder: **`/docs`**

MUST NOT: `gh-pages` branch, GitHub Actions that publish a different folder, Jekyll theme, MkDocs, Docusaurus, Hugo. MUST keep `docs/.nojekyll` so GitHub does not run Jekyll.

`docs.html` is an HTTP app (Pages). Opening it as a `file://` URL SHOULD be expected to fail `fetch`; that is why markdown also stands alone as files. Do not add a “docs dev server” Just recipe unless someone actually needs it — `python -m http.server` in `docs/` is enough.

### 5.1 URL map

Origin: `https://iamtew.github.io/hesh-ups/` (or the Pages URL of the repo).

| Repo path | Pages URL | For |
| --- | --- | --- |
| `docs/index.html` | `/` | Landing |
| `docs/docs.html` | `/docs.html` | Manual viewer |
| `docs/docs.html#overview` | `/docs.html#overview` | Viewer loads `md/overview.md` |
| `docs/md/overview.md` | `/md/overview.md` | Raw file; GitHub blob view is the nice renderer |
| `docs/img/foo.png` | `/img/foo.png` | Images |
| `docs/SPEC.md` | (do not advertise) | Implementer spec on GitHub blob, not a Pages chapter |

`docs.js` MUST `fetch("md/" + id + ".md")`, rewrite sibling `name.md` links to `#name`, rewrite `../img/` to `img/` (jb2). Markdown MUST keep those relative links so GitHub and editors work without the viewer.

Landing MUST link Documentation to `docs.html`. README MUST link `docs/md/overview.md` (file) and `docs/index.html` (site).

### 5.2 Required tree

```
docs/
  .nojekyll
  index.html
  docs.html
  docs.js
  style.css
  favicon.ico             # derived: just icon-docs
  img/
    logo.png              # derived: copy of assets/logo.png
  md/
    overview.md
    running.md
    composer.md
    triggers.md
    overlay.md
    http.md
    obs.md
    credits.md            # vendored third-party notices (Pages)
  vendor/                 # marked + tabler subset; MUST NOT be CDN-only
    marked.min.js
    tabler/
      LICENSE
      icons.svg
```

`icons.svg` MUST exist if the HTML references it; otherwise omit.

`docs/md/` ids = filenames without `.md`, listed in `docs.js`. New operator topic = new file + nav entry. Do not grow `overview.md` into a dump.

| File | Reader |
| --- | --- |
| `overview.md` | What it is, jobs, links |
| `running.md` | Install, tray, Browser Source, OBS audio checkbox |
| `composer.md` | Slots, templates, playback, Test |
| `triggers.md` | Fire/stop list, copy trigger URLs |
| `overlay.md` | Canvas, overlay page, WebSocket |
| `http.md` | Trigger URLs, token, hide |
| `obs.md` | obs-websocket, source setup, scenes |
| `credits.md` | Vendored Tabler + marked notices |

### 5.3 SPEC

Implementer spec is **`docs/SPEC.md`** (one copy). GitHub renders it in the repo UI. MUST NOT add it to `docs.js` unless you deliberately want the operator manual to include the implementer spec. MUST NOT maintain a second copy at repo root.

---

## 6. `cmd/hesh-ups/` — all Go

```
cmd/hesh-ups/
  main.go
  http.go                 # split when a file earns the name
  db.go
  obs.go
  tray.go
  hub.go
  slots.go
  *_test.go
  testdata/
  icon.ico                  # derived: just icon-app
  rsrc_windows_amd64.syso   # derived: exe PE icon
  icons/                    # Tabler tray .ico (subset; see docs/md/credits.md)
  web/
    overlay/
      index.html
      style.css
      app.js
    triggers/
      index.html
      style.css
      app.js
    composer/
      index.html
      style.css
      app.js
      icons.svg             # same sprite as docs/vendor/tabler/icons.svg
    shared/
      banner.css            # text popup shell tokens
      look.js               # text fit / type knobs on overlay + composer
      themes/<id>/theme.css + theme.js
      vendor/pixi/          # PixiJS MIT pin + LICENSE
```

`package main`. Tests in `package main` (same package) so they can call the server without exporting a library. MUST NOT extract `internal/` until a second binary exists.

```
go build -ldflags "-X main.version=<VERSION>" -o dist/hesh-ups.exe ./cmd/hesh-ups
```

`just test`: `go vet ./...` and `go test ./...`. MUST cover hesh-ups.md R1–R23 by starting the app `Serve` on `127.0.0.1:0` with a temp DB and `embed.FS`. No `httptest`. MUST NOT `exec` the exe, MUST NOT start systray or WebView, MUST NOT `Listen` on the product port. Tests that import `main` MAY build tray files but MUST skip tray/window init (`main` only calling tray from `main()`). Live OBS (R11) MUST skip when `obs` is false. A live check is only the tray already on `http://127.0.0.1:18745`. If `GET /api/health` fails, say the tray app is not up. Do not start a second one.

No CGO (`CGO_ENABLED=0`). Dist is **windows/amd64**. MUST NOT add fake `GOOS=linux` recipes while that is true.

Listen: product `main()` binds `bind:port`; failure logs to stderr and `os.Exit(1)`. No file mutex.

`/api/health` SHOULD include `"version"` equal to `VERSION`.

---

## 7. Process UI — embed `cmd/hesh-ups/web/`

This is the **only** overlay/composer/triggers source. Compiled into the exe. Not Pages. Not a folder on disk at runtime.

| Repo path | HTTP |
| --- | --- |
| `cmd/hesh-ups/web/overlay/` | `/overlay/` (`index.html`, `style.css`, `app.js`) |
| `cmd/hesh-ups/web/triggers/` | `/triggers/` (fire/stop/copy-URL list; `/board/` 301s here) |
| `cmd/hesh-ups/web/composer/` | `/composer/` (designer chrome: bar, layers, canvas, inspector, settings modal, `favicon.png`) |
| `cmd/hesh-ups/web/shared/` | `/shared/` (banner.css, themes, vendored Pixi). Overlay and composer both load these. |

`package main` MUST `//go:embed all:web` and serve that `embed.FS`. `just run` / `just test` / dist / MSI all use the same embed. HTTP 301 `/overlay` → `/overlay/`, `/composer` → `/composer/`, and `/triggers` → `/triggers/` so relative assets resolve. `/board` and `/board/` 301 to `/triggers/`. Composer, overlay, and triggers are **vanilla** HTML/CSS/JS (hesh-ups.md); no npm in this tree.

`GET /media/` is the **data** media folder (next to the DB). Not embedded.

MUST NOT: copy `web/` next to the exe; read UI from cwd, exe dir, or `%APPDATA%`; an “override” or “reset overlay files” folder; a second HTML tree (`webroot/`, `www/`, `static/`, `docs/overlay`). Reinstall/rebuild is how UI comes back. User slot media stays in AppData.

---

## 8. `packaging/` — MSI

```
packaging/
  hesh-ups.wxs            # WiX 5, Scope="perUser"
  license.rtf
```

Install: `%LOCALAPPDATA%\Programs\hesh-ups`. Payload is **`hesh-ups.exe` only**. UpgradeCode (permanent): `8f3c2a91-6b4e-4d17-9c08-e2a1b7f04d63`. Start Menu shortcut is an optional feature, default on. MSI MUST NOT create, migrate, or delete the SQLite file. MUST NOT install a `web/` directory.

`wix` on PATH (`dotnet tool install -g wix`).

---

## 9. `dist/` (generated)

`just package` wipes `dist/` and writes **`hesh-ups.exe` only**. MUST NOT copy `web/` into `dist/`.

`just build-dist` also writes:

- `dist/hesh-ups-<VERSION>-win-x64.zip` (the exe at zip root)
- `dist/hesh-ups-<VERSION>-win-x64.msi`

---

## 10. Justfile

PowerShell. `default` → `just --list`.

| Recipe | MUST |
| --- | --- |
| `run` | from repo root: `go run ./cmd/hesh-ups` |
| `build` | ldflags version → `dist/hesh-ups.exe` |
| `test` | `go vet ./...` and `go test ./...` (app `Serve` on `127.0.0.1:0`; hesh-ups.md R1–R23) |
| `fmt` | `go fmt ./...` |
| `package` | `build` → `dist/hesh-ups.exe` only |
| `verify-package` | fail if exe missing or if `dist/web` exists |
| `msi-only` | WiX from current `dist/` |
| `msi` | `package` then `msi-only` |
| `build-dist` | `package` + zip + MSI |
| `clean` | delete `dist/`; `go clean` |
| `icon` | `icon-docs` + `icon-web` + `icon-app` from `assets/logo.png` |
| `icon-docs` | copy `docs/img/logo.png`; magick `docs/favicon.ico` |
| `icon-web` | magick 32px `cmd/hesh-ups/web/composer/favicon.png` |
| `icon-app` | magick `cmd/hesh-ups/icon.ico`; rsrc `.syso` |

`just icon` requires `magick` on PATH. Never overwrite `assets/logo.png` or `assets/logo.af`. Commit the derived files so build/test/Pages do not need ImageMagick. WiX uses `cmd/hesh-ups/icon.ico` (no second copy under `packaging/`).

MUST NOT add recipes that emit a website outside `docs/`.

---

## 11. README and AGENTS

README: one paragraph, `just run` / `just test` / `just build-dist`, links to `docs/md/overview.md` and `docs/index.html`, license.

AGENTS.md: `docs/SPEC.md` + this layout; `master`; **ship it** = commit + push; no PRs unless asked.

---

## 12. Do not “fix”

- Pages stays **`/docs` on `master`**.
- Overlay/composer/triggers stay in `cmd/hesh-ups/web/` and **embed**. No disk UI, no AppData skin folder.
- Do not ship `web/` beside the exe.
- Manual stays `docs/md/` + `docs.html` (no extra SSG).
- Do not add `internal/` for one binary.
- Do not put sqlite in the install folder.
- Do not invent Linux dist while the tray/WebView stack is Windows-only.
- This file plus [SPEC.md](SPEC.md) is the **product**, not a slice. Seed ships zip+MSI+Pages.
