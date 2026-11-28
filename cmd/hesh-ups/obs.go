package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type obsClient struct {
	s      *Server
	mu     sync.Mutex
	conn   *websocket.Conn
	online bool
	scene  string
	list   []string
	wait   map[string]chan obsResp
	cancel context.CancelFunc
	kickCh chan struct{}
}

type obsResp struct {
	status json.RawMessage
	data   json.RawMessage
	err    error
}

func newOBS(s *Server) *obsClient {
	o := &obsClient{s: s, wait: map[string]chan obsResp{}, kickCh: make(chan struct{}, 1)}
	ctx, cancel := context.WithCancel(context.Background())
	o.cancel = cancel
	go o.loop(ctx)
	return o
}

func (o *obsClient) stop() {
	if o.cancel != nil {
		o.cancel()
	}
	o.mu.Lock()
	if o.conn != nil {
		o.conn.Close(websocket.StatusNormalClosure, "")
	}
	o.online = false
	o.mu.Unlock()
}

func (o *obsClient) kick() {
	o.mu.Lock()
	if o.conn != nil {
		o.conn.Close(websocket.StatusNormalClosure, "")
		o.conn = nil
	}
	o.mu.Unlock()
	select {
	case o.kickCh <- struct{}{}:
	default:
	}
}

func (o *obsClient) connected() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.online
}

func (o *obsClient) scenes() ([]string, string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.list, o.scene
}

func (o *obsClient) loop(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		err := o.session(ctx)
		o.mu.Lock()
		o.online = false
		o.list = nil
		o.scene = ""
		if o.conn != nil {
			o.conn.Close(websocket.StatusNormalClosure, "")
			o.conn = nil
		}
		o.mu.Unlock()
		if err == nil {
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-o.kickCh:
			backoff = time.Second
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 15*time.Second {
			backoff = 15 * time.Second
		}
		if backoff < time.Second {
			backoff = time.Second
		}
		if backoff == 0 {
			backoff = time.Second
		}
	}
}

func (o *obsClient) session(ctx context.Context) error {
	host := o.s.setting("obs_host")
	port := o.s.setting("obs_port")
	pass := o.s.setting("obs_password")
	url := "ws://" + host + ":" + port
	dctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	c, _, err := websocket.Dial(dctx, url, nil)
	cancel()
	if err != nil {
		return err
	}
	_, data, err := c.Read(ctx)
	if err != nil {
		c.Close(websocket.StatusNormalClosure, "")
		return err
	}
	var hello struct {
		Op int `json:"op"`
		D  struct {
			Authentication *struct {
				Challenge string `json:"challenge"`
				Salt      string `json:"salt"`
			} `json:"authentication"`
		} `json:"d"`
	}
	if json.Unmarshal(data, &hello) != nil {
		c.Close(websocket.StatusNormalClosure, "")
		return errors.New("hello")
	}
	ident := map[string]any{"op": 1, "d": map[string]any{"rpcVersion": 1}}
	if hello.D.Authentication != nil {
		ident["d"] = map[string]any{"rpcVersion": 1, "authentication": obsAuth(pass, hello.D.Authentication.Salt, hello.D.Authentication.Challenge)}
	}
	b, _ := json.Marshal(ident)
	if err := c.Write(ctx, websocket.MessageText, b); err != nil {
		c.Close(websocket.StatusNormalClosure, "")
		return err
	}
	_, data, err = c.Read(ctx)
	if err != nil {
		c.Close(websocket.StatusNormalClosure, "")
		return err
	}
	var identified struct {
		Op int `json:"op"`
	}
	if json.Unmarshal(data, &identified) != nil || identified.Op != 2 {
		c.Close(websocket.StatusNormalClosure, "")
		return errors.New("identify")
	}
	o.mu.Lock()
	o.conn = c
	o.online = true
	o.mu.Unlock()
	done := make(chan struct{})
	go func() {
		o.readLoop(ctx, c)
		close(done)
	}()
	_, _ = o.request("GetSceneList", nil)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return errors.New("disconnected")
	}
}

func (o *obsClient) readLoop(ctx context.Context, c *websocket.Conn) {
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var msg struct {
			Op int             `json:"op"`
			D  json.RawMessage `json:"d"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.Op != 7 {
			continue
		}
		var d struct {
			RequestId     string          `json:"requestId"`
			RequestStatus json.RawMessage `json:"requestStatus"`
			ResponseData  json.RawMessage `json:"responseData"`
		}
		if json.Unmarshal(msg.D, &d) != nil {
			continue
		}
		if d.RequestId == "" {
			continue
		}
		o.mu.Lock()
		ch := o.wait[d.RequestId]
		delete(o.wait, d.RequestId)
		if d.ResponseData != nil {
			var sl struct {
				CurrentProgramSceneName string `json:"currentProgramSceneName"`
				Scenes                  []struct {
					SceneName string `json:"sceneName"`
				} `json:"scenes"`
			}
			if json.Unmarshal(d.ResponseData, &sl) == nil && sl.Scenes != nil {
				names := make([]string, 0, len(sl.Scenes))
				for _, sc := range sl.Scenes {
					names = append(names, sc.SceneName)
				}
				o.list = names
				o.scene = sl.CurrentProgramSceneName
			}
		}
		o.mu.Unlock()
		if ch != nil {
			ch <- obsResp{status: d.RequestStatus, data: d.ResponseData}
		}
	}
}

func (o *obsClient) request(typ string, data any) (json.RawMessage, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	ch := make(chan obsResp, 1)
	o.mu.Lock()
	c := o.conn
	if c == nil || !o.online {
		o.mu.Unlock()
		return nil, errors.New("disconnected")
	}
	o.wait[id] = ch
	o.mu.Unlock()
	body := map[string]any{"op": 6, "d": map[string]any{"requestType": typ, "requestId": id}}
	if data != nil {
		body["d"].(map[string]any)["requestData"] = data
	}
	b, _ := json.Marshal(body)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		return nil, err
	}
	select {
	case r := <-ch:
		return r.data, r.err
	case <-time.After(5 * time.Second):
		return nil, errors.New("timeout")
	}
}

func obsAuth(password, salt, challenge string) string {
	h := sha256.Sum256([]byte(password + salt))
	secret := base64.StdEncoding.EncodeToString(h[:])
	h2 := sha256.Sum256([]byte(secret + challenge))
	return base64.StdEncoding.EncodeToString(h2[:])
}

func (o *obsClient) ensureBrowserSource() error {
	raw, err := o.request("GetSceneList", nil)
	if err != nil {
		return err
	}
	var sl struct {
		CurrentProgramSceneName string `json:"currentProgramSceneName"`
		Scenes                  []struct {
			SceneName string `json:"sceneName"`
		} `json:"scenes"`
	}
	_ = json.Unmarshal(raw, &sl)
	if len(sl.Scenes) == 0 {
		return errors.New("no_scenes")
	}
	name := o.s.setting("obs_browser_source")
	if name == "" {
		name = "hesh-ups"
	}
	in, err := o.request("GetInputList", nil)
	if err != nil {
		return err
	}
	var il struct {
		Inputs []struct {
			InputName string `json:"inputName"`
			InputKind string `json:"inputKind"`
		} `json:"inputs"`
	}
	_ = json.Unmarshal(in, &il)
	cw, _ := strconv.Atoi(o.s.setting("canvas_w"))
	ch, _ := strconv.Atoi(o.s.setting("canvas_h"))
	port := o.s.setting("port")
	settings := map[string]any{
		"url":                    "http://127.0.0.1:" + port + "/overlay/",
		"width":                  cw,
		"height":                 ch,
		"css":                    "body { background-color: rgba(0,0,0,0) !important; margin: 0; overflow: hidden; }",
		"shutdown":               false,
		"restart_when_active":    false,
		"reroute_audio":          true,
		"fps":                    30,
		"fps_custom":             false,
		"webpage_control_level":  1,
	}
	created := false
	for _, in := range il.Inputs {
		if in.InputName == name {
			if in.InputKind != "browser_source" {
				return errors.New("input_wrong_kind")
			}
			_, err = o.request("SetInputSettings", map[string]any{
				"inputName":     name,
				"overlay":       true,
				"inputSettings": settings,
			})
			if err != nil {
				return err
			}
			created = true
			break
		}
	}
	if !created {
		_, err = o.request("CreateInput", map[string]any{
			"sceneName":        sl.CurrentProgramSceneName,
			"inputName":        name,
			"inputKind":        "browser_source",
			"sceneItemEnabled": true,
			"inputSettings":    settings,
		})
		if err != nil {
			return err
		}
	}
	o.attachSourceToScenes(name, sl.Scenes)
	return nil
}

func sceneHasSource(items []string, name string) bool {
	for _, n := range items {
		if n == name {
			return true
		}
	}
	return false
}

func (o *obsClient) attachSourceToScenes(name string, scenes []struct {
	SceneName string `json:"sceneName"`
}) {
	for _, sc := range scenes {
		raw, err := o.request("GetSceneItemList", map[string]any{"sceneName": sc.SceneName})
		if err != nil {
			continue
		}
		var items struct {
			SceneItems []struct {
				SourceName string `json:"sourceName"`
			} `json:"sceneItems"`
		}
		_ = json.Unmarshal(raw, &items)
		names := make([]string, 0, len(items.SceneItems))
		for _, it := range items.SceneItems {
			names = append(names, it.SourceName)
		}
		if sceneHasSource(names, name) {
			continue
		}
		_, _ = o.request("CreateSceneItem", map[string]any{
			"sceneName":        sc.SceneName,
			"sourceName":       name,
			"sceneItemEnabled": true,
		})
	}
}

func (o *obsClient) setScene(name string) error {
	_, err := o.request("SetCurrentProgramScene", map[string]any{"sceneName": name})
	return err
}
