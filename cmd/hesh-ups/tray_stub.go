//go:build !windows

package main

import (
	"fmt"
	"os"
)

func runTray(s *Server) {
	fmt.Fprintln(os.Stderr, "hesh-ups is Windows-only")
}
