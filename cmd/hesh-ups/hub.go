package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

type hubClient struct {
	c  *websocket.Conn
	mu sync.Mutex
}

func (cl *hubClient) write(b []byte) error {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return cl.c.Write(context.Background(), websocket.MessageText, b)
}

type Hub struct {
	mu      sync.Mutex
	clients map[*hubClient]struct{}
	onEnded func(slot string, seq int)
}

func newHub() *Hub {
	return &Hub{clients: map[*hubClient]struct{}{}}
}

func (h *Hub) broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.Lock()
	list := make([]*hubClient, 0, len(h.clients))
	for c := range h.clients {
		list = append(list, c)
	}
	h.mu.Unlock()
	for _, c := range list {
		_ = c.write(b)
	}
}

func (h *Hub) serve(w http.ResponseWriter, r *http.Request, onConnect func(*hubClient)) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	cl := &hubClient{c: c}
	h.mu.Lock()
	h.clients[cl] = struct{}{}
	h.mu.Unlock()
	if onConnect != nil {
		onConnect(cl)
	}
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, cl)
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
				_ = cl.write([]byte(`{"type":"pong"}`))
				continue
			}
			if msg.Type == "ended" && msg.Seq != nil && h.onEnded != nil {
				h.onEnded(msg.Slot, *msg.Seq)
			}
		}
	}()
}

func (h *Hub) send(c *hubClient, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_ = c.write(b)
}
