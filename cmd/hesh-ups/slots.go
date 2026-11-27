package main

import (
	"html"
	"regexp"
	"strconv"
	"time"
)

var (
	slotIDRe   = regexp.MustCompile(`^[a-z0-9-]+$`)
	cssClassRe = regexp.MustCompile(`^[a-zA-Z0-9_-]*$`)
	phRe       = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)
)

type liveSlot struct {
	Seq       int
	Text      string
	MediaKind string
	MediaPath string
	Playback  string
	Volume    int
	Duration  *int
}

type Slot struct {
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
	CSSClass     string `json:"css_class"`
	Visible      bool   `json:"visible,omitempty"`
	Text         string `json:"text,omitempty"`
}

type Event struct {
	ID     int64  `json:"id"`
	TS     string `json:"ts"`
	Action string `json:"action"`
	SlotID string `json:"slot_id"`
	Detail string `json:"detail"`
	Result string `json:"result"`
}

func (s *Server) fire(id string, vars map[string]string, durOverride *int) (text string, code int, errKey, errMsg string) {
	sl, ok := s.getSlot(id)
	if !ok || !sl.Enabled {
		return "", 404, "unknown_slot", "unknown slot"
	}
	text = renderTemplate(sl.TextTemplate, vars)
	s.mu.Lock()
	s.seq[id]++
	seq := s.seq[id]
	eff := sl.DurationMS
	if durOverride != nil {
		if *durOverride == 0 {
			eff = nil
		} else {
			eff = durOverride
		}
	}
	s.live[id] = liveSlot{
		Seq: seq, Text: text, MediaKind: sl.MediaKind, MediaPath: sl.MediaPath,
		Playback: sl.Playback, Volume: sl.Volume, Duration: eff,
	}
	if t, ok := s.timers[id]; ok {
		t.Stop()
		delete(s.timers, id)
	}
	sticky := eff == nil
	if sticky {
		_, _ = s.db.Exec(`INSERT INTO visible(slot_id,seq,text,media_kind,media_path) VALUES(?,?,?,?,?)
			ON CONFLICT(slot_id) DO UPDATE SET seq=excluded.seq,text=excluded.text,media_kind=excluded.media_kind,media_path=excluded.media_path`,
			id, seq, text, sl.MediaKind, sl.MediaPath)
	} else {
		_, _ = s.db.Exec(`DELETE FROM visible WHERE slot_id=?`, id)
		ms := *eff
		s.timers[id] = time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
			s.hide(id, "duration")
		})
	}
	show := map[string]any{
		"type": "show", "slot": id, "seq": seq,
		"media_kind": sl.MediaKind, "media_url": mediaURL(sl),
		"playback": sl.Playback, "volume": sl.Volume, "text": text,
		"duration_ms": jsonDur(eff),
	}
	s.mu.Unlock()
	s.logEvent("show", id, "", "ok")
	s.hub.broadcast(show)
	return text, 200, "", ""
}

func (s *Server) hide(id string, reason string) {
	s.mu.Lock()
	if _, ok := s.live[id]; !ok {
		s.mu.Unlock()
		return
	}
	delete(s.live, id)
	if t, ok := s.timers[id]; ok {
		t.Stop()
		delete(s.timers, id)
	}
	s.mu.Unlock()
	_, _ = s.db.Exec(`DELETE FROM visible WHERE slot_id=?`, id)
	s.logEvent("hide", id, reason, "ok")
	s.hub.broadcast(map[string]any{"type": "hide", "slot": id})
}

func (s *Server) hideAll() {
	s.mu.Lock()
	s.live = map[string]liveSlot{}
	for id, t := range s.timers {
		t.Stop()
		delete(s.timers, id)
	}
	s.mu.Unlock()
	_, _ = s.db.Exec(`DELETE FROM visible`)
	s.logEvent("hide_all", "", "", "ok")
	s.hub.broadcast(map[string]any{"type": "clear"})
}

func (s *Server) ended(slot string, seq int) {
	s.mu.Lock()
	lv, ok := s.live[slot]
	s.mu.Unlock()
	if !ok || lv.Seq != seq {
		return
	}
	s.hide(slot, "ended")
}

func mediaURL(sl Slot) string {
	if sl.MediaKind == "none" || sl.MediaPath == "" {
		return ""
	}
	return "/media/" + sl.MediaPath
}

func jsonDur(d *int) any {
	if d == nil {
		return nil
	}
	return *d
}

func renderTemplate(tmpl string, vars map[string]string) string {
	out := phRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		name := phRe.FindStringSubmatch(m)[1]
		return vars[name]
	})
	return html.EscapeString(out)
}

func validSlot(sl Slot) (errKey, msg string) {
	if !slotIDRe.MatchString(sl.ID) {
		return "invalid_slot", "invalid slot id"
	}
	if sl.ID == "hide_all" {
		return "reserved_id", "reserved id"
	}
	switch sl.MediaKind {
	case "none", "image", "gif", "video", "audio":
	default:
		return "invalid_slot", "invalid media_kind"
	}
	if sl.Playback == "" {
		sl.Playback = "once"
	}
	if sl.Playback != "once" && sl.Playback != "loop" {
		return "invalid_slot", "invalid playback"
	}
	if sl.CSSClass != "" && !cssClassRe.MatchString(sl.CSSClass) {
		return "invalid_slot", "invalid css_class"
	}
	hasMedia := sl.MediaKind != "none" && sl.MediaPath != ""
	if !hasMedia && sl.TextTemplate == "" {
		return "empty_slot", "empty slot"
	}
	return "", ""
}

func atoiPtr(s string) *int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return nil
	}
	return &n
}
