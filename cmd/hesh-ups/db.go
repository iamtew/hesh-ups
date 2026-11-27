package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var defaultSettings = map[string]string{
	"schema_version":     "1",
	"bind":               "127.0.0.1",
	"port":               "18745",
	"token":              "",
	"canvas_w":           "1920",
	"canvas_h":           "1080",
	"obs_host":           "127.0.0.1",
	"obs_port":           "4455",
	"obs_password":       "",
	"obs_browser_source": "hesh-ups",
	"last_scene":         "",
	"composer_grid":      "thirds,center,safe",
	"composer_snap":      "1",
	"autostart":          "0",
}

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	var ver string
	err := db.QueryRow(`SELECT value FROM settings WHERE key='schema_version'`).Scan(&ver)
	if err != nil {
		return createSchema(db)
	}
	n, _ := strconv.Atoi(ver)
	if n > 1 {
		return fmt.Errorf("schema_version %d is newer than this binary", n)
	}
	return nil
}

func createSchema(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS slots (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			x INTEGER NOT NULL,
			y INTEGER NOT NULL,
			w INTEGER NOT NULL,
			h INTEGER NOT NULL,
			z INTEGER NOT NULL DEFAULT 0,
			media_kind TEXT NOT NULL,
			media_path TEXT NOT NULL DEFAULT '',
			text_template TEXT NOT NULL DEFAULT '',
			playback TEXT NOT NULL DEFAULT 'once',
			duration_ms INTEGER,
			volume INTEGER NOT NULL DEFAULT 100,
			enabled INTEGER NOT NULL DEFAULT 1,
			css_class TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS event_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts TEXT NOT NULL,
			action TEXT NOT NULL,
			slot_id TEXT,
			detail TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS visible (
			slot_id TEXT PRIMARY KEY,
			seq INTEGER NOT NULL,
			text TEXT NOT NULL DEFAULT '',
			media_kind TEXT NOT NULL,
			media_path TEXT NOT NULL DEFAULT ''
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}
	for k, v := range defaultSettings {
		if _, err := db.Exec(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, k, v); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) setting(key string) string {
	var v string
	if err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v); err != nil {
		return defaultSettings[key]
	}
	return v
}

func (s *Server) setSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func (s *Server) loadSlots() ([]Slot, error) {
	rows, err := s.db.Query(`SELECT id,label,x,y,w,h,z,media_kind,media_path,text_template,playback,duration_ms,volume,enabled,css_class FROM slots`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Slot
	for rows.Next() {
		sl, err := scanSlot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sl)
	}
	if out == nil {
		out = []Slot{}
	}
	return out, rows.Err()
}

func scanSlot(rows interface {
	Scan(dest ...any) error
}) (Slot, error) {
	var sl Slot
	var dur sql.NullInt64
	var css sql.NullString
	var en int
	err := rows.Scan(&sl.ID, &sl.Label, &sl.X, &sl.Y, &sl.W, &sl.H, &sl.Z, &sl.MediaKind, &sl.MediaPath, &sl.TextTemplate, &sl.Playback, &dur, &sl.Volume, &en, &css)
	if err != nil {
		return sl, err
	}
	if dur.Valid {
		d := int(dur.Int64)
		sl.DurationMS = &d
	}
	sl.Enabled = en != 0
	if css.Valid {
		sl.CSSClass = css.String
	}
	return sl, nil
}

func (s *Server) getSlot(id string) (Slot, bool) {
	row := s.db.QueryRow(`SELECT id,label,x,y,w,h,z,media_kind,media_path,text_template,playback,duration_ms,volume,enabled,css_class FROM slots WHERE id=?`, id)
	sl, err := scanSlot(row)
	if err != nil {
		return Slot{}, false
	}
	return sl, true
}

func (s *Server) upsertSlot(sl Slot) error {
	var dur any
	if sl.DurationMS != nil {
		dur = *sl.DurationMS
	}
	en := 0
	if sl.Enabled {
		en = 1
	}
	_, err := s.db.Exec(`INSERT INTO slots(id,label,x,y,w,h,z,media_kind,media_path,text_template,playback,duration_ms,volume,enabled,css_class)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET label=excluded.label,x=excluded.x,y=excluded.y,w=excluded.w,h=excluded.h,z=excluded.z,
		media_kind=excluded.media_kind,media_path=excluded.media_path,text_template=excluded.text_template,playback=excluded.playback,
		duration_ms=excluded.duration_ms,volume=excluded.volume,enabled=excluded.enabled,css_class=excluded.css_class`,
		sl.ID, sl.Label, sl.X, sl.Y, sl.W, sl.H, sl.Z, sl.MediaKind, sl.MediaPath, sl.TextTemplate, sl.Playback, dur, sl.Volume, en, sl.CSSClass)
	return err
}

func (s *Server) logEvent(action, slotID, detail, result string) {
	_, _ = s.db.Exec(`INSERT INTO event_log(ts,action,slot_id,detail,result) VALUES(?,?,?,?,?)`, time.Now().UTC().Format(time.RFC3339Nano), action, nullStr(slotID), detail, result)
	_, _ = s.db.Exec(`DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT 500)`)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Server) recentEvents(n int) []Event {
	rows, err := s.db.Query(`SELECT id,ts,action,slot_id,detail,result FROM event_log ORDER BY id DESC LIMIT ?`, n)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var sid sql.NullString
		if rows.Scan(&e.ID, &e.TS, &e.Action, &sid, &e.Detail, &e.Result) == nil {
			if sid.Valid {
				e.SlotID = sid.String
			}
			out = append(out, e)
		}
	}
	if out == nil {
		out = []Event{}
	}
	return out
}

func (s *Server) restoreVisible() {
	rows, err := s.db.Query(`SELECT slot_id,seq,text,media_kind,media_path FROM visible`)
	if err != nil {
		return
	}
	defer rows.Close()
	s.mu.Lock()
	defer s.mu.Unlock()
	for rows.Next() {
		var id, text, kind, path string
		var seq int
		if rows.Scan(&id, &seq, &text, &kind, &path) != nil {
			continue
		}
		s.live[id] = liveSlot{Seq: seq, Text: text, MediaKind: kind, MediaPath: path}
		if seq > s.seq[id] {
			s.seq[id] = seq
		}
	}
}

func mediaKindFromExt(name string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp":
		return "image", true
	case ".gif":
		return "gif", true
	case ".mp4", ".webm":
		return "video", true
	case ".mp3", ".wav", ".ogg":
		return "audio", true
	default:
		return "", false
	}
}
