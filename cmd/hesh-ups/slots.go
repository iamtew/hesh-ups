package main

import (
	"encoding/json"
	"html"
	"regexp"
	"strconv"
	"time"
)

var (
	slotIDRe = regexp.MustCompile(`^[a-z0-9-]+$`)
	phRe     = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)
)

var themes = map[string]bool{
	"plain": true, "lcd-glass": true, "sesh-glass": true, "sesh-glass-old": true, "3026-d3c0": true,
}

type showMember struct {
	ID        string `json:"id"`
	MediaKind string `json:"media_kind"`
	MediaURL  string `json:"media_url"`
	Playback  string `json:"playback"`
	Volume    int    `json:"volume"`
	Text      string `json:"text"`
	Theme     string `json:"theme"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	W         int    `json:"w"`
	H         int    `json:"h"`
	Z         int    `json:"z"`
}

type liveSlot struct {
	Seq       int
	Text      string
	MediaKind string
	MediaPath string
	Playback  string
	Volume    int
	Theme     string
	Duration  *int
	Members   []showMember
	WaitEnded bool
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
	CSSClass     string `json:"css_class,omitempty"`
	ParentID     string `json:"parent_id"`
	Theme        string `json:"theme"`
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
	if !ok || !sl.Enabled || sl.ParentID != "" {
		return "", 404, "unknown_slot", "unknown slot"
	}
	var members []showMember
	if sl.MediaKind == "group" {
		kids := s.childSlots(id)
		for _, c := range kids {
			if !c.Enabled {
				continue
			}
			members = append(members, memberPayload(c, vars))
		}
		if len(members) == 0 {
			return "", 400, "empty_slot", "empty slot"
		}
	}
	text = renderTemplate(sl.TextTemplate, vars)
	s.mu.Lock()
	s.seq[id]++
	seq := s.seq[id]
	eff := sl.DurationMS
	if durOverride != nil {
		if *durOverride <= 0 {
			eff = nil
		} else {
			eff = durOverride
		}
	}
	if eff != nil && *eff <= 0 {
		eff = nil
	}
	wait := waitEnded(sl, members, eff)
	sticky := eff == nil && !wait
	lv := liveSlot{
		Seq: seq, Text: text, MediaKind: sl.MediaKind, MediaPath: sl.MediaPath,
		Playback: sl.Playback, Volume: sl.Volume, Theme: sl.Theme, Duration: eff,
		Members: members, WaitEnded: wait,
	}
	s.live[id] = lv
	if t, ok := s.timers[id]; ok {
		t.Stop()
		delete(s.timers, id)
	}
	visText := text
	if sl.MediaKind == "group" {
		b, _ := json.Marshal(members)
		visText = string(b)
	}
	if sticky {
		_, _ = s.db.Exec(`INSERT INTO visible(slot_id,seq,text,media_kind,media_path) VALUES(?,?,?,?,?)
			ON CONFLICT(slot_id) DO UPDATE SET seq=excluded.seq,text=excluded.text,media_kind=excluded.media_kind,media_path=excluded.media_path`,
			id, seq, visText, sl.MediaKind, sl.MediaPath)
	} else {
		_, _ = s.db.Exec(`DELETE FROM visible WHERE slot_id=?`, id)
		if eff != nil {
			ms := *eff
			s.timers[id] = time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
				s.hide(id, "duration")
			})
		}
	}
	show := showMap(id, sl, lv)
	s.mu.Unlock()
	s.logEvent("show", id, "", "ok")
	s.hub.broadcast(show)
	return text, 200, "", ""
}

func memberPayload(c Slot, vars map[string]string) showMember {
	th := c.Theme
	if th == "" {
		th = "plain"
	}
	return showMember{
		ID: c.ID, MediaKind: c.MediaKind, MediaURL: mediaURL(c),
		Playback: c.Playback, Volume: c.Volume, Text: renderTemplate(c.TextTemplate, vars),
		Theme: th, X: c.X, Y: c.Y, W: c.W, H: c.H, Z: c.Z,
	}
}

func showMap(id string, sl Slot, lv liveSlot) map[string]any {
	m := map[string]any{
		"type": "show", "slot": id, "seq": lv.Seq,
		"media_kind": sl.MediaKind, "media_url": mediaURL(sl),
		"playback": sl.Playback, "volume": sl.Volume, "text": lv.Text,
		"theme": sl.Theme, "duration_ms": jsonDur(lv.Duration),
	}
	if sl.MediaKind == "group" {
		m["members"] = lv.Members
		m["media_url"] = ""
		m["text"] = ""
	}
	return m
}

func waitEnded(sl Slot, members []showMember, eff *int) bool {
	if eff != nil {
		return false
	}
	if sl.MediaKind == "video" || sl.MediaKind == "audio" {
		return sl.Playback != "loop"
	}
	if sl.MediaKind != "group" {
		return false
	}
	hasOnce, hasLoop := false, false
	for _, c := range members {
		if c.MediaKind != "video" && c.MediaKind != "audio" {
			continue
		}
		if c.Playback == "loop" {
			hasLoop = true
		} else {
			hasOnce = true
		}
	}
	return hasOnce && !hasLoop
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
	wait := ok && lv.WaitEnded && lv.Seq == seq
	s.mu.Unlock()
	if !wait {
		return
	}
	s.hide(slot, "ended")
}

func mediaURL(sl Slot) string {
	if sl.MediaKind == "text" || sl.MediaKind == "group" || sl.MediaPath == "" {
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
	case "text", "image", "gif", "video", "audio", "group":
	default:
		return "invalid_slot", "invalid media_kind"
	}
	if sl.Playback == "" {
		sl.Playback = "once"
	}
	if sl.Playback != "once" && sl.Playback != "loop" {
		return "invalid_slot", "invalid playback"
	}
	if sl.Theme == "" {
		sl.Theme = "plain"
	}
	if !themes[sl.Theme] {
		return "invalid_slot", "invalid theme"
	}
	if sl.MediaKind == "group" && sl.ParentID != "" {
		return "invalid_slot", "nested group"
	}
	switch sl.MediaKind {
	case "text":
		if sl.TextTemplate == "" {
			return "empty_slot", "empty slot"
		}
	case "image", "gif", "video", "audio":
		if sl.MediaPath == "" {
			return "empty_slot", "empty slot"
		}
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
