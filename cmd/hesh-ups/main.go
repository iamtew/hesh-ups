package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	dbPath := os.Getenv("HESH_UPS_DB")
	if dbPath == "" {
		dir := filepath.Join(os.Getenv("APPDATA"), "hesh-ups")
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
		dbPath = filepath.Join(dir, "hesh-ups.sqlite")
	}
	setupFileLog(dbPath)
	srv, err := NewServer(dbPath, version)
	if err != nil {
		return err
	}
	defer srv.Close()
	addr := srv.setting("bind") + ":" + srv.setting("port")
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	go http.Serve(ln, srv.Handler())
	runTray(srv)
	return nil
}
