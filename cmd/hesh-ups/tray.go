//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
	"github.com/jchv/go-webview2"
)

func runTray(s *Server) {
	systray.Run(func() { onReady(s) }, func() {})
}

func onReady(s *Server) {
	systray.SetIcon(icon16())
	systray.SetTooltip("hesh-ups " + version)
	mComposer := systray.AddMenuItem("Composer", "Open composer")
	mOverlay := systray.AddMenuItem("Overlay preview", "Open overlay")
	mOBS := systray.AddMenuItem("OBS: disconnected", "")
	mOBS.Disable()
	mAuto := systray.AddMenuItemCheckbox("Run at login", "", s.setting("autostart") == "1")
	mData := systray.AddMenuItem("Open data folder", "")
	mQuit := systray.AddMenuItem("Exit", "")
	base := "http://" + s.setting("bind") + ":" + s.setting("port")
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for range t.C {
			if s.obs.connected() {
				mOBS.SetTitle("OBS: connected")
			} else {
				mOBS.SetTitle("OBS: disconnected")
			}
		}
	}()
	go func() {
		for {
			select {
			case <-mComposer.ClickedCh:
				openView("Composer", base+"/composer/", 1280, 800)
			case <-mOverlay.ClickedCh:
				openView("Overlay", base+"/overlay/", 1280, 720)
			case <-mAuto.ClickedCh:
				on := !mAuto.Checked()
				if on {
					mAuto.Check()
				} else {
					mAuto.Uncheck()
				}
				v := "0"
				if on {
					v = "1"
				}
				_ = s.setSetting("autostart", v)
				setAutostart(on)
			case <-mData.ClickedCh:
				_ = exec.Command("explorer.exe", s.dataDir).Start()
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func openView(title, url string, w, h int) {
	wv := webview2.New(false)
	if wv == nil {
		messageBox("hesh-ups", "WebView2 is required.")
		os.Exit(1)
	}
	wv.SetTitle(title)
	wv.SetSize(w, h, webview2.HintNone)
	wv.Navigate(url)
	wv.Run()
	wv.Destroy()
}

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}

func icon16() []byte {
	const w, h = 16, 16
	xor := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		xor[i*4+0] = 255
		xor[i*4+1] = 255
		xor[i*4+2] = 0
		xor[i*4+3] = 255
	}
	and := make([]byte, w*h/8)
	dibSize := 40 + len(xor) + len(and)
	ico := make([]byte, 22+dibSize)
	ico[2], ico[4] = 1, 1
	ico[6], ico[7] = 16, 16
	ico[10], ico[11] = 1, 32
	put32 := func(p, v int) {
		ico[p] = byte(v)
		ico[p+1] = byte(v >> 8)
		ico[p+2] = byte(v >> 16)
		ico[p+3] = byte(v >> 24)
	}
	put32(14, dibSize)
	put32(18, 22)
	put32(22, 40)
	put32(26, w)
	put32(30, h*2)
	ico[34], ico[36] = 1, 32
	copy(ico[62:], xor)
	copy(ico[62+len(xor):], and)
	return ico
}
