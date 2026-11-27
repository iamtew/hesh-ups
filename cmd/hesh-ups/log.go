package main

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
)

const logMax = 2 << 20

type rotatingWriter struct {
	path string
	mu   sync.Mutex
	f    *os.File
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f != nil {
		if st, err := w.f.Stat(); err == nil && st.Size()+int64(len(p)) > logMax {
			w.f.Close()
			os.Rename(w.path, w.path+".1")
			w.f = nil
		}
	}
	if w.f == nil {
		f, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return 0, err
		}
		w.f = f
	}
	return w.f.Write(p)
}

func setupFileLog(dbPath string) {
	dir := filepath.Dir(dbPath)
	os.MkdirAll(dir, 0755)
	w := &rotatingWriter{path: filepath.Join(dir, "hesh-ups.log")}
	log.SetOutput(io.MultiWriter(os.Stderr, w))
	log.SetFlags(log.LstdFlags)
}
