//go:build windows

package main

import (
	_ "embed"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
	"github.com/jchv/go-webview2"
)

//go:embed icon.ico
var trayIcon []byte

func runTray(s *Server) {
	systray.Run(func() { onReady(s) }, func() {})
}

func onReady(s *Server) {
	systray.SetIcon(trayIcon)
	systray.SetTooltip("hesh-ups " + version)
	mComposer := systray.AddMenuItem("Composer", "Open composer")
	mComposerWin := mComposer.AddSubMenuItem("Open window", "Open composer WebView")
	mComposerWeb := mComposer.AddSubMenuItem("Open in browser", "Open composer in browser")
	mOverlay := systray.AddMenuItem("Overlay preview", "Open overlay")
	mOverlayWin := mOverlay.AddSubMenuItem("Open window", "Open overlay WebView")
	mOverlayWeb := mOverlay.AddSubMenuItem("Open in browser", "Open overlay in browser")
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
			case <-mComposerWin.ClickedCh:
				openView("Composer", base+"/composer/", 1280, 800)
			case <-mComposerWeb.ClickedCh:
				openBrowser(base + "/composer/")
			case <-mOverlayWin.ClickedCh:
				openView("Overlay", base+"/overlay/", 1280, 720)
			case <-mOverlayWeb.ClickedCh:
				openBrowser(base + "/overlay/")
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

func openBrowser(url string) {
	cmd := exec.Command("cmd", "/c", "start", "", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
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
