package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

var png1x1 = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
	0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x24, 0xf0, 0x5a, 0xdd, 0x00, 0x00,
	0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func testSrv(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	s, err := NewServer(filepath.Join(dir, "t.sqlite"), "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(func() { ts.Close(); s.Close() })
	return s, ts
}

func getJSON(t *testing.T, ts *httptest.Server, path string, dest any) *http.Response {
	t.Helper()
	res, err := http.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if dest != nil {
		if err := json.Unmarshal(body, dest); err != nil {
			t.Fatalf("json %s: %s", err, body)
		}
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	return res
}

func doJSON(t *testing.T, method, url string, body any) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, url, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, b
}

func putLogo(t *testing.T, s *Server, ts *httptest.Server) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(s.mediaDir, "logo.png"), png1x1, 0644); err != nil {
		t.Fatal(err)
	}
	res, b := doJSON(t, "PUT", ts.URL+"/api/slots/logo", map[string]any{
		"id": "logo", "label": "Logo", "x": 100, "y": 40, "w": 320, "h": 180, "z": 1,
		"media_kind": "image", "media_path": "logo.png", "text_template": "",
		"playback": "once", "duration_ms": nil, "volume": 100, "enabled": true, "css_class": "",
	})
	if res.StatusCode != 200 {
		t.Fatalf("put logo %d %s", res.StatusCode, b)
	}
}

func wsDial(t *testing.T, ts *httptest.Server) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	c, _, err := websocket.Dial(context.Background(), u, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(websocket.StatusNormalClosure, "") })
	return c
}

func readType(t *testing.T, c *websocket.Conn, want string, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		_, data, err := c.Read(ctx)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if m["type"] == want {
			return m
		}
	}
	t.Fatalf("no ws type %s", want)
	return nil
}

func TestR1Health(t *testing.T) {
	_, ts := testSrv(t)
	var h map[string]any
	res := getJSON(t, ts, "/api/health", &h)
	if res.StatusCode != 200 || h["ok"] != true || h["db"] != true || h["version"] == nil || h["version"] == "" {
		t.Fatalf("%v", h)
	}
}

func TestR2SeedSlot(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	slots := st["slots"].([]any)
	found := false
	for _, raw := range slots {
		m := raw.(map[string]any)
		if m["id"] == "logo" {
			found = true
			if m["visible"] == true {
				t.Fatal("visible")
			}
		}
	}
	if !found {
		t.Fatal("no logo")
	}
}

func TestR3Fire(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	res, _ := doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	show := readType(t, c, "show", 2*time.Second)
	if show["slot"] != "logo" {
		t.Fatalf("%v", show)
	}
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	ev := st["events"].([]any)[0].(map[string]any)
	if ev["action"] != "show" || ev["result"] != "ok" {
		t.Fatalf("%v", ev)
	}
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["visible"] != true {
			t.Fatal("not visible")
		}
	}
}

func TestR4Hide(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	readType(t, c, "show", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/logo/hide", nil)
	hide := readType(t, c, "hide", 2*time.Second)
	if hide["slot"] != "logo" {
		t.Fatal(hide)
	}
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	if st["events"].([]any)[0].(map[string]any)["action"] != "hide" {
		t.Fatal(st["events"])
	}
}

func TestR5HideAll(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "PUT", ts.URL+"/api/slots/a", map[string]any{
		"id": "a", "label": "A", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "A", "playback": "once", "volume": 100, "enabled": true,
	})
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	doJSON(t, "POST", ts.URL+"/api/popup/a", nil)
	readType(t, c, "show", 2*time.Second)
	readType(t, c, "show", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/hide_all", nil)
	readType(t, c, "clear", 2*time.Second)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	if st["events"].([]any)[0].(map[string]any)["action"] != "hide_all" {
		t.Fatal(st["events"])
	}
}

func TestR6Duration(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "POST", ts.URL+"/api/popup/logo?duration_ms=200", nil)
	time.Sleep(400 * time.Millisecond)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["visible"] == true {
			t.Fatal("still visible")
		}
	}
}

func TestR7RestartTimer(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "POST", ts.URL+"/api/popup/logo?duration_ms=500", nil)
	time.Sleep(300 * time.Millisecond)
	doJSON(t, "POST", ts.URL+"/api/popup/logo?duration_ms=500", nil)
	time.Sleep(300 * time.Millisecond)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	vis := false
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" {
			vis = m["visible"] == true
		}
	}
	if !vis {
		t.Fatal("should still be visible at t=600")
	}
	time.Sleep(300 * time.Millisecond)
	getJSON(t, ts, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["visible"] == true {
			t.Fatal("should hide after second duration")
		}
	}
}

func TestR8Unknown(t *testing.T) {
	_, ts := testSrv(t)
	res, b := doJSON(t, "POST", ts.URL+"/api/popup/nope", nil)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode, string(b))
	}
	var e map[string]any
	json.Unmarshal(b, &e)
	if e["error"] != "unknown_slot" {
		t.Fatal(e)
	}
}

func TestR9InvalidID(t *testing.T) {
	_, ts := testSrv(t)
	res, _ := doJSON(t, "PUT", ts.URL+"/api/slots/Not%20Valid", map[string]any{
		"id": "Not Valid", "label": "x", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "x", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode)
	}
}

func TestR10Token(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/settings", map[string]string{"token": "secret"})
	doJSON(t, "PUT", ts.URL+"/api/slots/t", map[string]any{
		"id": "t", "label": "t", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "hi", "playback": "once", "volume": 100, "enabled": true,
	})
	res, _ := doJSON(t, "POST", ts.URL+"/api/popup/t", nil)
	if res.StatusCode != 401 {
		t.Fatal(res.StatusCode)
	}
	res, _ = doJSON(t, "POST", ts.URL+"/api/popup/t?token=secret", nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
}

func TestR11OBSOptional(t *testing.T) {
	_, ts := testSrv(t)
	var h map[string]any
	getJSON(t, ts, "/api/health", &h)
	if h["ok"] != true {
		t.Fatal(h)
	}
	if h["obs"] == true {
		t.Skip("live OBS")
	}
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	if st["obs"].(map[string]any)["connected"] != false {
		t.Fatal(st["obs"])
	}
	res, _ := doJSON(t, "POST", ts.URL+"/api/obs/browser-source", nil)
	if res.StatusCode != 503 {
		t.Fatal(res.StatusCode)
	}
}

func TestR12Snapshot(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	c := wsDial(t, ts)
	cfg := readType(t, c, "config", 2*time.Second)
	if cfg["type"] != "config" {
		t.Fatal(cfg)
	}
	snap := readType(t, c, "snapshot", 2*time.Second)
	found := false
	for _, raw := range snap["visible"].([]any) {
		if raw.(map[string]any)["id"] == "logo" {
			found = true
		}
	}
	if !found {
		t.Fatal(snap)
	}
}

func TestR13DBOverride(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	s2, err := NewServer(filepath.Join(t.TempDir(), "b.sqlite"), "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	ts2 := httptest.NewServer(s2.Handler())
	defer ts2.Close()
	var st map[string]any
	getJSON(t, ts2, "/api/state", &st)
	if len(st["slots"].([]any)) != 0 {
		t.Fatal(st["slots"])
	}
}

func TestR14Text(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/slots/follow", map[string]any{
		"id": "follow", "label": "f", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "Thanks {user}!", "playback": "once", "volume": 100, "enabled": true,
	})
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	res, b := doJSON(t, "POST", ts.URL+"/api/popup/follow?user=Ada", nil)
	if res.StatusCode != 200 {
		t.Fatal(string(b))
	}
	var body map[string]any
	json.Unmarshal(b, &body)
	if body["text"] != "Thanks Ada!" {
		t.Fatal(body)
	}
	show := readType(t, c, "show", 2*time.Second)
	if show["text"] != "Thanks Ada!" {
		t.Fatal(show)
	}
	res, b = doJSON(t, "POST", ts.URL+"/api/popup/follow", nil)
	json.Unmarshal(b, &body)
	if body["text"] != "Thanks !" {
		t.Fatal(body)
	}
}

func TestDurationZeroIsSticky(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/slots/follow", map[string]any{
		"id": "follow", "label": "f", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "Hi", "playback": "once", "duration_ms": 0, "volume": 100, "enabled": true,
	})
	doJSON(t, "POST", ts.URL+"/api/popup/follow", nil)
	time.Sleep(80 * time.Millisecond)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	found := false
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] != "follow" {
			continue
		}
		found = true
		if m["visible"] != true {
			t.Fatal("duration 0 hid the slot")
		}
	}
	if !found {
		t.Fatal("missing slot")
	}
}

func TestR15Empty(t *testing.T) {
	_, ts := testSrv(t)
	res, _ := doJSON(t, "PUT", ts.URL+"/api/slots/empty", map[string]any{
		"id": "empty", "label": "e", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode)
	}
}

func TestR16LoopDuration(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/slots/loop", map[string]any{
		"id": "loop", "label": "l", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "x", "playback": "loop", "duration_ms": 200, "volume": 100, "enabled": true,
	})
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/loop", nil)
	show := readType(t, c, "show", 2*time.Second)
	if show["playback"] != "loop" {
		t.Fatal(show)
	}
	time.Sleep(400 * time.Millisecond)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "loop" && m["visible"] == true {
			t.Fatal("visible")
		}
	}
}

func TestR17Ended(t *testing.T) {
	s, ts := testSrv(t)
	os.WriteFile(filepath.Join(s.mediaDir, "clip.webm"), []byte("x"), 0644)
	doJSON(t, "PUT", ts.URL+"/api/slots/clip", map[string]any{
		"id": "clip", "label": "c", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "video", "media_path": "clip.webm", "text_template": "",
		"playback": "once", "duration_ms": nil, "volume": 100, "enabled": true,
	})
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/clip", nil)
	show := readType(t, c, "show", 2*time.Second)
	seq := int(show["seq"].(float64))
	_ = c.Write(context.Background(), websocket.MessageText, []byte(`{"type":"ended","slot":"clip","seq":`+itoa(seq)+`}`))
	readType(t, c, "hide", 2*time.Second)

	doJSON(t, "POST", ts.URL+"/api/popup/clip", nil)
	show = readType(t, c, "show", 2*time.Second)
	n := int(show["seq"].(float64))
	doJSON(t, "POST", ts.URL+"/api/popup/clip", nil)
	show = readType(t, c, "show", 2*time.Second)
	_ = show
	_ = c.Write(context.Background(), websocket.MessageText, []byte(`{"type":"ended","slot":"clip","seq":`+itoa(n)+`}`))
	time.Sleep(50 * time.Millisecond)
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "clip" && m["visible"] != true {
			t.Fatal("stale ended hid")
		}
	}
	_ = c.Write(context.Background(), websocket.MessageText, []byte(`{"type":"ended","slot":"nope"}`))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestR18Reserved(t *testing.T) {
	_, ts := testSrv(t)
	res, _ := doJSON(t, "PUT", ts.URL+"/api/slots/hide_all", map[string]any{
		"id": "hide_all", "label": "x", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "x", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode)
	}
}

func TestR19Media(t *testing.T) {
	_, ts := testSrv(t)
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "logo.png")
	fw.Write(png1x1)
	w.Close()
	req, _ := http.NewRequest("POST", ts.URL+"/api/media", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	if m["kind"] != "image" {
		t.Fatal(m)
	}
	gr, err := http.Get(ts.URL + "/media/" + m["path"].(string))
	if err != nil || gr.StatusCode != 200 {
		t.Fatal(gr)
	}
	gr.Body.Close()

	buf.Reset()
	w = multipart.NewWriter(&buf)
	fw, _ = w.CreateFormFile("file", "../x.png")
	fw.Write(png1x1)
	w.Close()
	req, _ = http.NewRequest("POST", ts.URL+"/api/media", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, _ = http.DefaultClient.Do(req)
	b, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode, string(b))
	}
	buf.Reset()
	w = multipart.NewWriter(&buf)
	fw, _ = w.CreateFormFile("file", "x.exe")
	fw.Write([]byte("MZ"))
	w.Close()
	req, _ = http.NewRequest("POST", ts.URL+"/api/media", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode)
	}
}

func TestR20Volume(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "PUT", ts.URL+"/api/slots/logo", map[string]any{
		"id": "logo", "label": "Logo", "x": 100, "y": 40, "w": 320, "h": 180, "z": 1,
		"media_kind": "image", "media_path": "logo.png", "text_template": "",
		"playback": "once", "volume": 40, "enabled": true,
	})
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	show := readType(t, c, "show", 2*time.Second)
	if show["volume"] != float64(40) {
		t.Fatal(show)
	}
}

func TestR21Sticky(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "t.sqlite")
	s, err := NewServer(db, "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Handler())
	putLogo(t, s, ts)
	doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	ts.Close()
	s.Close()

	s2, err := NewServer(db, "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	ts2 := httptest.NewServer(s2.Handler())
	defer ts2.Close()
	var st map[string]any
	getJSON(t, ts2, "/api/state", &st)
	ok := false
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["visible"] == true {
			ok = true
		}
	}
	if !ok {
		t.Fatal("sticky not restored")
	}
	c := wsDial(t, ts2)
	readType(t, c, "config", 2*time.Second)
	snap := readType(t, c, "snapshot", 2*time.Second)
	found := false
	for _, raw := range snap["visible"].([]any) {
		if raw.(map[string]any)["id"] == "logo" {
			found = true
		}
	}
	if !found {
		t.Fatal(snap)
	}

	db3 := filepath.Join(t.TempDir(), "x.sqlite")
	s3, err := NewServer(db3, "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	ts3 := httptest.NewServer(s3.Handler())
	os.WriteFile(filepath.Join(s3.mediaDir, "logo.png"), png1x1, 0644)
	doJSON(t, "PUT", ts3.URL+"/api/slots/logo", map[string]any{
		"id": "logo", "label": "Logo", "x": 1, "y": 1, "w": 40, "h": 40, "z": 0,
		"media_kind": "image", "media_path": "logo.png", "playback": "once", "duration_ms": 200, "volume": 100, "enabled": true,
	})
	doJSON(t, "POST", ts3.URL+"/api/popup/logo", nil)
	time.Sleep(400 * time.Millisecond)
	ts3.Close()
	s3.Close()
	s4, err := NewServer(db3, "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer s4.Close()
	ts4 := httptest.NewServer(s4.Handler())
	defer ts4.Close()
	getJSON(t, ts4, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["visible"] == true {
			t.Fatal("timed should not restore")
		}
	}
}

func TestR22Disabled(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "PUT", ts.URL+"/api/slots/logo", map[string]any{
		"id": "logo", "label": "Logo", "x": 100, "y": 40, "w": 320, "h": 180, "z": 1,
		"media_kind": "image", "media_path": "logo.png", "playback": "once", "volume": 100, "enabled": false,
	})
	res, b := doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode, string(b))
	}
}

func TestR23Envelope(t *testing.T) {
	_, ts := testSrv(t)
	res, b := doJSON(t, "POST", ts.URL+"/api/popup/nope", nil)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
	var e map[string]any
	json.Unmarshal(b, &e)
	if e["error"] == nil || e["message"] == nil {
		t.Fatal(e)
	}
}

func TestGetSettings(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/settings", map[string]string{"token": "secret"})
	var kv map[string]string
	res := getJSON(t, ts, "/api/settings", &kv)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	if _, ok := kv["schema_version"]; ok {
		t.Fatal("schema_version should be omitted")
	}
	if kv["token"] != "secret" {
		t.Fatal(kv["token"])
	}
	if kv["obs_host"] != "127.0.0.1" {
		t.Fatal(kv["obs_host"])
	}
}

func TestQuitHook(t *testing.T) {
	s, ts := testSrv(t)
	n := 0
	closed := 0
	s.closeViews = func() { closed++ }
	s.onQuit = func() { n++ }
	res, _ := doJSON(t, "POST", ts.URL+"/api/quit", nil)
	if res.StatusCode != 204 {
		t.Fatal(res.StatusCode)
	}
	if n != 1 || closed != 1 {
		t.Fatal(n, closed)
	}
}

func TestViewCloseAndHelp(t *testing.T) {
	s, ts := testSrv(t)
	closed, helped := 0, 0
	s.closeViews = func() { closed++ }
	s.onHelp = func() { helped++ }
	res, _ := doJSON(t, "POST", ts.URL+"/api/view/close", nil)
	if res.StatusCode != 204 {
		t.Fatal(res.StatusCode)
	}
	res, _ = doJSON(t, "POST", ts.URL+"/api/help", nil)
	if res.StatusCode != 204 {
		t.Fatal(res.StatusCode)
	}
	if closed != 1 || helped != 1 {
		t.Fatal(closed, helped)
	}
}

func TestEnabledPut(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	doJSON(t, "PUT", ts.URL+"/api/slots/logo", map[string]any{
		"id": "logo", "label": "Logo", "x": 100, "y": 40, "w": 320, "h": 180, "z": 1,
		"media_kind": "image", "media_path": "logo.png", "playback": "once", "volume": 100, "enabled": false,
	})
	var st map[string]any
	getJSON(t, ts, "/api/state", &st)
	for _, raw := range st["slots"].([]any) {
		m := raw.(map[string]any)
		if m["id"] == "logo" && m["enabled"] != false {
			t.Fatal(m["enabled"])
		}
	}
	res, _ := doJSON(t, "POST", ts.URL+"/api/popup/logo", nil)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
}

func TestSharedBanner(t *testing.T) {
	_, ts := testSrv(t)
	res, err := http.Get(ts.URL + "/shared/banner.css")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
}

func TestBoardPage(t *testing.T) {
	_, ts := testSrv(t)
	res, err := http.Get(ts.URL + "/board/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	b, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(b), "hesh-ups board") {
		t.Fatal("missing board html")
	}
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	redir, err := c.Get(ts.URL + "/board")
	if err != nil {
		t.Fatal(err)
	}
	defer redir.Body.Close()
	if redir.StatusCode != http.StatusMovedPermanently {
		t.Fatal(redir.StatusCode)
	}
}

func TestExclusiveKinds(t *testing.T) {
	_, ts := testSrv(t)
	res, _ := doJSON(t, "PUT", ts.URL+"/api/slots/bad", map[string]any{
		"id": "bad", "label": "b", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "none", "text_template": "x", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 400 {
		t.Fatal("none should 400", res.StatusCode)
	}
	res, _ = doJSON(t, "PUT", ts.URL+"/api/slots/img", map[string]any{
		"id": "img", "label": "i", "x": 0, "y": 0, "w": 40, "h": 40, "z": 0,
		"media_kind": "image", "media_path": "", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 400 {
		t.Fatal("image without path", res.StatusCode)
	}
}

func TestGroupFire(t *testing.T) {
	_, ts := testSrv(t)
	res, b := doJSON(t, "PUT", ts.URL+"/api/slots/raid", map[string]any{
		"id": "raid", "label": "Raid", "x": 10, "y": 10, "w": 400, "h": 200, "z": 1,
		"media_kind": "group", "playback": "once", "volume": 100, "enabled": true,
	})
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	res, b = doJSON(t, "POST", ts.URL+"/api/popup/raid", nil)
	if res.StatusCode != 400 {
		t.Fatal("empty group", res.StatusCode, string(b))
	}
	doJSON(t, "PUT", ts.URL+"/api/slots/raid-t", map[string]any{
		"id": "raid-t", "label": "t", "x": 0, "y": 0, "w": 100, "h": 40, "z": 0,
		"media_kind": "text", "text_template": "Hi {user}", "playback": "once", "volume": 100,
		"enabled": true, "parent_id": "raid", "theme": "lcd-glass",
	})
	res, b = doJSON(t, "POST", ts.URL+"/api/popup/raid-t?user=Ada", nil)
	if res.StatusCode != 404 {
		t.Fatal("child fire", res.StatusCode, string(b))
	}
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	res, b = doJSON(t, "POST", ts.URL+"/api/popup/raid?user=Ada", nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	show := readType(t, c, "show", 2*time.Second)
	if show["media_kind"] != "group" {
		t.Fatal(show)
	}
	mem, _ := show["members"].([]any)
	if len(mem) != 1 {
		t.Fatalf("members %v", show["members"])
	}
	m0 := mem[0].(map[string]any)
	if m0["text"] != "Hi Ada" || m0["theme"] != "lcd-glass" {
		t.Fatal(m0)
	}
	doJSON(t, "POST", ts.URL+"/api/popup/raid/hide", nil)
	hide := readType(t, c, "hide", 2*time.Second)
	if hide["slot"] != "raid" {
		t.Fatal(hide)
	}
}

func TestSchemaV1Migrate(t *testing.T) {
	dir := t.TempDir()
	dbp := filepath.Join(dir, "old.sqlite")
	db, err := sql.Open("sqlite", dbp+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE slots (
			id TEXT PRIMARY KEY, label TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
			w INTEGER NOT NULL, h INTEGER NOT NULL, z INTEGER NOT NULL DEFAULT 0,
			media_kind TEXT NOT NULL, media_path TEXT NOT NULL DEFAULT '',
			text_template TEXT NOT NULL DEFAULT '', playback TEXT NOT NULL DEFAULT 'once',
			duration_ms INTEGER, volume INTEGER NOT NULL DEFAULT 100,
			enabled INTEGER NOT NULL DEFAULT 1, css_class TEXT)`,
		`CREATE TABLE event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, action TEXT NOT NULL, slot_id TEXT, detail TEXT NOT NULL DEFAULT '', result TEXT NOT NULL)`,
		`CREATE TABLE visible (slot_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', media_kind TEXT NOT NULL, media_path TEXT NOT NULL DEFAULT '')`,
		`INSERT INTO settings(key,value) VALUES('schema_version','1')`,
		`INSERT INTO slots(id,label,x,y,w,h,z,media_kind,media_path,text_template,playback,volume,enabled) VALUES('old','Old',0,0,40,40,0,'none','','Hi','once',100,1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	db.Close()
	s, err := NewServer(dbp, "0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	sl, ok := s.getSlot("old")
	if !ok || sl.MediaKind != "text" || sl.Theme != "plain" {
		t.Fatalf("%v %v", ok, sl)
	}
	if s.setting("schema_version") != "3" {
		t.Fatal(s.setting("schema_version"))
	}
	if sl.Look.Fit != "shrink" || sl.Look.Motion != "fade" {
		t.Fatalf("look %#v", sl.Look)
	}
}

func TestObsKickOnSettings(t *testing.T) {
	_, ts := testSrv(t)
	res, b := doJSON(t, "PUT", ts.URL+"/api/settings", map[string]string{"obs_password": "x"})
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
}

func TestLookRoundtrip(t *testing.T) {
	_, ts := testSrv(t)
	res, b := doJSON(t, "PUT", ts.URL+"/api/slots/follow", map[string]any{
		"id": "follow", "label": "Follow", "x": 10, "y": 10, "w": 400, "h": 80, "z": 1,
		"media_kind": "text", "text_template": "Thanks {user}!", "playback": "once",
		"volume": 100, "enabled": true,
		"look": map[string]any{"font_size": 40, "font_weight": 700, "fill": "#ff0", "stroke": "#000", "stroke_w": 0, "align": "left", "fit": "ellipsis", "motion": "slide"},
	})
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	var st struct {
		Slots []Slot `json:"slots"`
	}
	getJSON(t, ts, "/api/state", &st)
	if len(st.Slots) != 1 || st.Slots[0].Look.FontSize != 40 || st.Slots[0].Look.StrokeW != 0 || st.Slots[0].Look.Motion != "slide" {
		t.Fatalf("%+v", st.Slots)
	}
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	doJSON(t, "POST", ts.URL+"/api/popup/follow?user=Ada", nil)
	show := readType(t, c, "show", 2*time.Second)
	lk, _ := show["look"].(map[string]any)
	if lk["align"] != "left" || lk["fit"] != "ellipsis" {
		t.Fatal(show)
	}
	res, b = doJSON(t, "PUT", ts.URL+"/api/slots/follow", map[string]any{
		"id": "follow", "label": "Follow", "x": 10, "y": 10, "w": 400, "h": 80, "z": 1,
		"media_kind": "text", "text_template": "x", "playback": "once", "volume": 100, "enabled": true,
		"look": map[string]any{"motion": "zoom"},
	})
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode, string(b))
	}
}

func TestDuplicateGroup(t *testing.T) {
	_, ts := testSrv(t)
	doJSON(t, "PUT", ts.URL+"/api/slots/raid", map[string]any{
		"id": "raid", "label": "Raid", "x": 0, "y": 0, "w": 200, "h": 100, "z": 1,
		"media_kind": "group", "playback": "once", "volume": 100, "enabled": true,
	})
	doJSON(t, "PUT", ts.URL+"/api/slots/raid-t", map[string]any{
		"id": "raid-t", "label": "t", "x": 0, "y": 0, "w": 80, "h": 40, "z": 1,
		"media_kind": "text", "text_template": "Hi", "playback": "once", "volume": 100,
		"enabled": true, "parent_id": "raid",
	})
	res, b := doJSON(t, "POST", ts.URL+"/api/slots/raid/duplicate", nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	var cp Slot
	if json.Unmarshal(b, &cp) != nil || cp.ID != "raid-2" {
		t.Fatal(string(b))
	}
	var st struct {
		Slots []Slot `json:"slots"`
	}
	getJSON(t, ts, "/api/state", &st)
	kids := 0
	for _, sl := range st.Slots {
		if sl.ParentID == "raid-2" {
			kids++
		}
	}
	if kids != 1 {
		t.Fatalf("kids %d %+v", kids, st.Slots)
	}
	res, _ = doJSON(t, "POST", ts.URL+"/api/slots/raid-t/duplicate", nil)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
}

func TestFireMediaVolume(t *testing.T) {
	s, ts := testSrv(t)
	putLogo(t, s, ts)
	if err := os.WriteFile(filepath.Join(s.mediaDir, "alt.png"), png1x1, 0644); err != nil {
		t.Fatal(err)
	}
	c := wsDial(t, ts)
	readType(t, c, "config", 2*time.Second)
	readType(t, c, "snapshot", 2*time.Second)
	res, b := doJSON(t, "POST", ts.URL+"/api/popup/logo?media=alt.png&volume=40", nil)
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode, string(b))
	}
	show := readType(t, c, "show", 2*time.Second)
	if show["media_url"] != "/media/alt.png" {
		t.Fatal(show)
	}
	if vol, _ := show["volume"].(float64); vol != 40 {
		t.Fatal(show)
	}
	res, _ = doJSON(t, "POST", ts.URL+"/api/popup/logo?media=nope.png", nil)
	if res.StatusCode != 400 {
		t.Fatal(res.StatusCode)
	}
}

func TestSceneHasSource(t *testing.T) {
	if sceneHasSource([]string{"cam", "hesh-ups"}, "hesh-ups") == false {
		t.Fatal("miss")
	}
	if sceneHasSource([]string{"cam"}, "hesh-ups") {
		t.Fatal("false positive")
	}
}
