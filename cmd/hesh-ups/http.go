package main

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFS embed.FS

type Server struct {
	db       *sql.DB
	dbFile   string
	dataDir  string
	mediaDir string
	version  string
	hub      *Hub
	obs      *obsClient

	mu     sync.Mutex
	live   map[string]liveSlot
	seq    map[string]int
	timers map[string]*time.Timer

	// Tests stub these; tray sets real ones. Nil = 204 and do nothing.
	onQuit     func()
	onHelp     func()
	closeViews func()
}

func NewServer(dbPath, version string) (*Server, error) {
	db, err := openDB(dbPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(filepath.Dir(dbPath), "media"), 0755); err != nil {
		db.Close()
		return nil, err
	}
	s := &Server{
		db:       db,
		dbFile:   dbPath,
		dataDir:  filepath.Dir(dbPath),
		mediaDir: filepath.Join(filepath.Dir(dbPath), "media"),
		version:  version,
		hub:      newHub(),
		live:     map[string]liveSlot{},
		seq:      map[string]int{},
		timers:   map[string]*time.Timer{},
	}
	s.hub.onEnded = s.ended
	s.obs = newOBS(s)
	s.restoreVisible()
	return s, nil
}

func (s *Server) Close() {
	s.obs.stop()
	s.db.Close()
}

// Serve is the app HTTP server. main and tests both call this.
func (s *Server) Serve(ln net.Listener) error {
	return http.Serve(ln, s.Handler())
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/state", s.handleState)
	mux.HandleFunc("GET /api/slots", s.handleSlots)
	mux.HandleFunc("PUT /api/slots/{id}", s.handlePutSlot)
	mux.HandleFunc("POST /api/slots/{id}/duplicate", s.handleDuplicateSlot)
	mux.HandleFunc("DELETE /api/slots/{id}", s.handleDeleteSlot)
	mux.HandleFunc("GET /api/media", s.handleListMedia)
	mux.HandleFunc("POST /api/media", s.handleUpload)
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handleSettings)
	mux.HandleFunc("POST /api/quit", s.handleQuit)
	mux.HandleFunc("POST /api/view/close", s.handleViewClose)
	mux.HandleFunc("POST /api/help", s.handleHelp)
	mux.HandleFunc("GET /api/popup/stop_all", s.authed(s.handleStopAll))
	mux.HandleFunc("POST /api/popup/stop_all", s.authed(s.handleStopAll))
	mux.HandleFunc("GET /api/popup/{id}/stop", s.authed(s.handleStop))
	mux.HandleFunc("POST /api/popup/{id}/stop", s.authed(s.handleStop))
	mux.HandleFunc("GET /api/popup/{id}", s.authed(s.handleFire))
	mux.HandleFunc("POST /api/popup/{id}", s.authed(s.handleFire))
	mux.HandleFunc("POST /api/obs/browser-source", s.handleBrowserSource)
	mux.HandleFunc("GET /api/obs/scenes", s.handleScenes)
	mux.HandleFunc("GET /api/obs/scene/{name}", s.authed(s.handleSwitchScene))
	mux.HandleFunc("POST /api/obs/scene/{name}", s.authed(s.handleSwitchScene))
	mux.HandleFunc("GET /ws", s.handleWS)
	mux.HandleFunc("GET /overlay", redirectSlash)
	mux.HandleFunc("GET /composer", redirectSlash)
	mux.HandleFunc("GET /triggers", redirectSlash)
	mux.HandleFunc("GET /board", redirectTriggers)
	mux.HandleFunc("GET /board/", redirectTriggers)
	overlay, _ := fs.Sub(webFS, "web/overlay")
	composer, _ := fs.Sub(webFS, "web/composer")
	triggers, _ := fs.Sub(webFS, "web/triggers")
	shared, _ := fs.Sub(webFS, "web/shared")
	mux.Handle("/overlay/", http.StripPrefix("/overlay/", http.FileServer(http.FS(overlay))))
	mux.Handle("/composer/", http.StripPrefix("/composer/", http.FileServer(http.FS(composer))))
	mux.Handle("/triggers/", http.StripPrefix("/triggers/", http.FileServer(http.FS(triggers))))
	mux.Handle("/shared/", http.StripPrefix("/shared/", http.FileServer(http.FS(shared))))
	mux.HandleFunc("GET /media/", s.handleMediaFile)
	return mux
}

func redirectSlash(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
}

func redirectTriggers(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/triggers/", http.StatusMovedPermanently)
}

func writeErr(w http.ResponseWriter, code int, key, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": key, "message": msg})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) tokenOK(r *http.Request) bool {
	want := s.setting("token")
	if want == "" {
		return true
	}
	got := r.URL.Query().Get("token")
	if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
		got = strings.TrimPrefix(ah, "Bearer ")
	}
	return got == want
}

func (s *Server) authed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.tokenOK(r) {
			writeErr(w, 401, "unauthorized", "unauthorized")
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ok := s.db.Ping() == nil
	port, _ := strconv.Atoi(s.setting("port"))
	writeJSON(w, 200, map[string]any{
		"ok": ok, "db": ok, "obs": s.obs.connected(), "port": port, "version": s.version,
	})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	slots, err := s.loadSlots()
	if err != nil {
		writeErr(w, 500, "error", err.Error())
		return
	}
	cw, _ := strconv.Atoi(s.setting("canvas_w"))
	ch, _ := strconv.Atoi(s.setting("canvas_h"))
	s.mu.Lock()
	for i := range slots {
		if lv, ok := s.live[slots[i].ID]; ok {
			slots[i].Visible = true
			slots[i].Text = lv.Text
		}
	}
	s.mu.Unlock()
	scenes, cur := s.obs.scenes()
	if scenes == nil {
		scenes = []string{}
	}
	writeJSON(w, 200, map[string]any{
		"canvas": map[string]int{"w": cw, "h": ch},
		"obs":    map[string]any{"connected": s.obs.connected(), "scenes": scenes, "current_scene": cur},
		"slots":  slots,
		"events": s.recentEvents(50),
	})
}

func (s *Server) handleSlots(w http.ResponseWriter, r *http.Request) {
	slots, err := s.loadSlots()
	if err != nil {
		writeErr(w, 500, "error", err.Error())
		return
	}
	writeJSON(w, 200, slots)
}

func (s *Server) handlePutSlot(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var sl Slot
	if err := json.NewDecoder(r.Body).Decode(&sl); err != nil {
		writeErr(w, 400, "invalid_slot", "invalid json")
		return
	}
	if sl.ID == "" {
		sl.ID = id
	}
	if sl.ID != id {
		writeErr(w, 400, "invalid_slot", "id mismatch")
		return
	}
	if sl.Playback == "" {
		sl.Playback = "once"
	}
	if sl.Theme == "" {
		sl.Theme = "plain"
	}
	if sl.MediaKind != "text" {
		sl.Theme = "plain"
		if sl.MediaKind != "group" {
			sl.TextTemplate = ""
		}
	}
	if sl.MediaKind == "text" || sl.MediaKind == "group" {
		sl.MediaPath = ""
	}
	if sl.MediaKind == "group" {
		sl.TextTemplate = ""
	}
	if sl.ParentID != "" {
		p, ok := s.getSlot(sl.ParentID)
		if !ok || p.MediaKind != "group" || p.ID == sl.ID {
			writeErr(w, 400, "invalid_slot", "invalid parent")
			return
		}
	}
	if sl.Look.empty() {
		sl.Look = defaultLook()
	} else {
		sl.Look = sl.Look.norm()
	}
	if key, msg := validSlot(sl); key != "" {
		writeErr(w, 400, key, msg)
		return
	}
	old, had := s.getSlot(id)
	if err := s.upsertSlot(sl); err != nil {
		writeErr(w, 500, "error", err.Error())
		return
	}
	if had && old.MediaKind == "group" && sl.MediaKind != "group" {
		_, _ = s.db.Exec(`DELETE FROM slots WHERE parent_id=?`, id)
	}
	s.broadcastConfig()
	writeJSON(w, 200, sl)
}

func (s *Server) handleDeleteSlot(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if sl, ok := s.getSlot(id); ok && sl.ParentID != "" {
		s.hide(sl.ParentID, "delete")
	}
	s.hide(id, "delete")
	_, _ = s.db.Exec(`DELETE FROM slots WHERE parent_id=?`, id)
	_, _ = s.db.Exec(`DELETE FROM slots WHERE id=?`, id)
	s.broadcastConfig()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleDuplicateSlot(w http.ResponseWriter, r *http.Request) {
	sl, code, key, msg := s.duplicateSlot(r.PathValue("id"))
	if code != 200 {
		writeErr(w, code, key, msg)
		return
	}
	writeJSON(w, 200, sl)
}

func (s *Server) handleFire(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	opt := parseFire(r)
	text, code, key, msg := s.fire(id, opt.Vars, opt)
	if code != 200 {
		writeErr(w, code, key, msg)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": id, "visible": true, "text": text})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.hide(id, "")
	writeJSON(w, 200, map[string]any{"ok": true, "id": id, "visible": false})
}

func (s *Server) handleStopAll(w http.ResponseWriter, r *http.Request) {
	s.stopAll()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func parseFire(r *http.Request) fireOpts {
	opt := fireOpts{Vars: map[string]string{}}
	q := r.URL.Query()
	for k, vs := range q {
		if k == "token" || k == "vars" {
			continue
		}
		if k == "duration_ms" {
			opt.Dur = atoiPtr(vs[0])
			continue
		}
		if k == "media" {
			opt.Media = vs[0]
			continue
		}
		if k == "volume" {
			opt.Volume = atoiPtr(vs[0])
			continue
		}
		opt.Vars[k] = vs[0]
	}
	if r.Method == http.MethodPost && r.Header.Get("Content-Type") == "application/json" {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) == nil {
			for k, v := range body {
				if k == "token" || k == "vars" || k == "duration_ms" || k == "media" || k == "volume" {
					continue
				}
				opt.Vars[k] = stringify(v)
			}
			if raw, ok := body["vars"].(map[string]any); ok {
				for k, v := range raw {
					opt.Vars[k] = stringify(v)
				}
			}
			if v, ok := body["duration_ms"]; ok {
				switch n := v.(type) {
				case float64:
					i := int(n)
					opt.Dur = &i
				}
			}
			if v, ok := body["media"].(string); ok {
				opt.Media = v
			}
			if v, ok := body["volume"]; ok {
				switch n := v.(type) {
				case float64:
					i := int(n)
					opt.Volume = &i
				}
			}
		}
	}
	return opt
}

func stringify(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		b, _ := json.Marshal(t)
		return strings.Trim(string(b), `"`)
	}
}

func (s *Server) handleListMedia(w http.ResponseWriter, r *http.Request) {
	ents, _ := os.ReadDir(s.mediaDir)
	type file struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
	}
	var files []file
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		kind, ok := mediaKindFromExt(e.Name())
		if !ok {
			continue
		}
		files = append(files, file{e.Name(), kind})
	}
	if files == nil {
		files = []file{}
	}
	writeJSON(w, 200, map[string]any{"files": files})
}

var safeName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, 400, "too_large", "too large")
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "bad_media", "bad media")
		return
	}
	defer f.Close()
	name := hdr.Filename
	disp := hdr.Header.Get("Content-Disposition")
	if strings.Contains(name, "..") || strings.Contains(disp, "..") || !safeName.MatchString(filepath.Base(name)) {
		writeErr(w, 400, "bad_media", "bad media")
		return
	}
	base := filepath.Base(name)
	kind, ok := mediaKindFromExt(base)
	if !ok {
		writeErr(w, 400, "bad_media", "bad media")
		return
	}
	outName := base
	if _, err := os.Stat(filepath.Join(s.mediaDir, outName)); err == nil {
		ext := filepath.Ext(base)
		stem := strings.TrimSuffix(base, ext)
		var b [3]byte
		rand.Read(b[:])
		outName = stem + "-" + hex.EncodeToString(b[:]) + ext
	}
	dst, err := os.Create(filepath.Join(s.mediaDir, outName))
	if err != nil {
		writeErr(w, 500, "error", err.Error())
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, f); err != nil {
		writeErr(w, 400, "too_large", "too large")
		return
	}
	writeJSON(w, 200, map[string]string{"path": outName, "kind": kind})
}

func (s *Server) handleMediaFile(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/media/")
	if rel == "" || strings.Contains(rel, "..") || filepath.IsAbs(rel) {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Join(s.mediaDir, filepath.FromSlash(rel))
	if !strings.HasPrefix(clean, s.mediaDir) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, clean)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	out := map[string]string{}
	for k := range defaultSettings {
		if k == "schema_version" {
			continue
		}
		out[k] = s.setting(k)
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleQuit(w http.ResponseWriter, r *http.Request) {
	if s.closeViews != nil {
		s.closeViews()
	}
	if s.onQuit != nil {
		s.onQuit()
	}
	w.WriteHeader(204)
}

func (s *Server) handleViewClose(w http.ResponseWriter, r *http.Request) {
	if s.closeViews != nil {
		s.closeViews()
	}
	w.WriteHeader(204)
}

func (s *Server) handleHelp(w http.ResponseWriter, r *http.Request) {
	if s.onHelp != nil {
		s.onHelp()
	}
	w.WriteHeader(204)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	var kv map[string]string
	if err := json.NewDecoder(r.Body).Decode(&kv); err != nil {
		writeErr(w, 400, "invalid_slot", "invalid json")
		return
	}
	restart := false
	obsKick := false
	for k, v := range kv {
		if _, ok := defaultSettings[k]; !ok {
			continue
		}
		if k == "schema_version" {
			continue
		}
		if k == "bind" || k == "port" {
			restart = true
		}
		if strings.HasPrefix(k, "obs_") {
			obsKick = true
		}
		_ = s.setSetting(k, v)
		if k == "autostart" {
			setAutostart(v == "1")
		}
	}
	if obsKick {
		s.obs.kick()
	}
	s.broadcastConfig()
	msg := map[string]any{"ok": true}
	if restart {
		msg["message"] = "bind/port apply on next process start"
	}
	writeJSON(w, 200, msg)
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	s.hub.serve(w, r, func(c *hubClient) {
		s.hub.send(c, s.configMsg())
		s.hub.send(c, s.snapshot())
	})
}

func (s *Server) configMsg() map[string]any {
	slots, _ := s.loadSlots()
	cw, _ := strconv.Atoi(s.setting("canvas_w"))
	ch, _ := strconv.Atoi(s.setting("canvas_h"))
	type row struct {
		ID           string `json:"id"`
		Label        string `json:"label"`
		X            int    `json:"x"`
		Y            int    `json:"y"`
		W            int    `json:"w"`
		H            int    `json:"h"`
		Z            int    `json:"z"`
		MediaKind    string `json:"media_kind"`
		MediaPath    string `json:"media_path"`
		TextTemplate string `json:"text_template"`
		Playback     string `json:"playback"`
		DurationMS   *int   `json:"duration_ms"`
		Volume       int    `json:"volume"`
		Enabled      bool   `json:"enabled"`
		ParentID     string `json:"parent_id"`
		Theme        string `json:"theme"`
		Look         Look   `json:"look"`
	}
	rows := make([]row, 0, len(slots))
	for _, sl := range slots {
		rows = append(rows, row{
			sl.ID, sl.Label, sl.X, sl.Y, sl.W, sl.H, sl.Z, sl.MediaKind, sl.MediaPath,
			sl.TextTemplate, sl.Playback, sl.DurationMS, sl.Volume, sl.Enabled, sl.ParentID, sl.Theme, sl.Look.norm(),
		})
	}
	return map[string]any{"type": "config", "canvas": map[string]int{"w": cw, "h": ch}, "slots": rows}
}

func (s *Server) handleBrowserSource(w http.ResponseWriter, r *http.Request) {
	if !s.obs.connected() {
		writeErr(w, 503, "obs_disconnected", "obs disconnected")
		return
	}
	if err := s.obs.ensureBrowserSource(); err != nil {
		if err.Error() == "input_wrong_kind" {
			writeErr(w, 409, "input_wrong_kind", "input exists, not browser_source")
			return
		}
		if err.Error() == "no_scenes" {
			writeErr(w, 503, "no_scenes", "no scenes")
			return
		}
		writeErr(w, 500, "error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleScenes(w http.ResponseWriter, r *http.Request) {
	scenes, cur := s.obs.scenes()
	if scenes == nil {
		scenes = []string{}
	}
	writeJSON(w, 200, map[string]any{"connected": s.obs.connected(), "scenes": scenes, "current_scene": cur})
}

func (s *Server) handleSwitchScene(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !s.obs.connected() {
		writeErr(w, 503, "obs_disconnected", "obs disconnected")
		return
	}
	if err := s.obs.setScene(name); err != nil {
		writeErr(w, 404, "unknown_slot", err.Error())
		return
	}
	_ = s.setSetting("last_scene", name)
	s.logEvent("scene", "", name, "ok")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) broadcastConfig() {
	s.hub.broadcast(s.configMsg())
}

func (s *Server) snapshot() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var vis []map[string]any
	for id, lv := range s.live {
		sl, ok := s.getSlot(id)
		media := ""
		play := lv.Playback
		if ok {
			if lv.MediaPath != "" {
				media = mediaURLKind(sl.MediaKind, lv.MediaPath)
			} else {
				media = mediaURL(sl)
			}
			play = sl.Playback
		} else if lv.MediaPath != "" {
			media = "/media/" + lv.MediaPath
		}
		look := lv.Look
		if look.empty() && ok {
			look = sl.Look
		}
		row := map[string]any{
			"id": id, "seq": lv.Seq, "media_kind": lv.MediaKind, "media_url": media,
			"playback": play, "volume": lv.Volume, "text": lv.Text, "theme": lv.Theme,
			"look": look.norm(), "duration_ms": jsonDur(lv.Duration),
		}
		if ok && sl.Theme != "" {
			row["theme"] = sl.Theme
		}
		if lv.MediaKind == "group" {
			row["members"] = lv.Members
			row["media_url"] = ""
			row["text"] = ""
		}
		vis = append(vis, row)
	}
	if vis == nil {
		vis = []map[string]any{}
	}
	return map[string]any{"type": "snapshot", "visible": vis}
}
