//go:build !cgo

package main

import (
	"fmt"
	"os"
)

func runTray(s *Server) {
	fmt.Fprintln(os.Stderr, "hesh-ups needs CGO (systray/WebView2)")
}
