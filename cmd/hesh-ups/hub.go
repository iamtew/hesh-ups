package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
	onEnded func(slot string, seq int)
}

func newHub() *Hub {
	return &Hub{clients: map[*websocket.Conn]struct{}{}}
}

func (h *Hub) broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(h.clients))
	for c := range h.clients {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	for _, c := range conns {
		_ = c.Write(context.Background(), websocket.MessageText, b)
	}
}

func (h *Hub) serve(w http.ResponseWriter, r *http.Request, onConnect func(*websocket.Conn)) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	if onConnect != nil {
		onConnect(c)
	}
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			c.Close(websocket.StatusNormalClosure, "")
		}()
		for {
			_, data, err := c.Read(context.Background())
			if err != nil {
				return
			}
			var msg struct {
				Type string `json:"type"`
				Slot string `json:"slot"`
				Seq  *int   `json:"seq"`
			}
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			if msg.Type == "ping" {
				_ = c.Write(context.Background(), websocket.MessageText, []byte(`{"type":"pong"}`))
				continue
			}
			if msg.Type == "ended" && msg.Seq != nil && h.onEnded != nil {
				h.onEnded(msg.Slot, *msg.Seq)
			}
		}
	}()
}

func (h *Hub) send(c *websocket.Conn, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_ = c.Write(context.Background(), websocket.MessageText, b)
}
