//go:build windows

package main

import (
	"embed"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"
	"github.com/jchv/go-webview2"
)

const docsURL = "https://iamtew.github.io/hesh-ups/docs.html#composer"

var (
	viewMu     sync.Mutex
	composerWV webview2.WebView
	overlayWV  webview2.WebView
)

//go:embed icon.ico
var trayIcon []byte

//go:embed icons/*.ico
var menuIcons embed.FS

func runTray(s *Server) {
	systray.Run(func() { onReady(s) }, func() {})
}

func setMenuIcon(item *systray.MenuItem, name string) {
	b, err := menuIcons.ReadFile("icons/" + name + ".ico")
	if err != nil {
		return
	}
	item.SetIcon(b)
}

func onReady(s *Server) {
	s.closeViews = closeViews
	s.onHelp = func() { openBrowser(docsURL) }
	s.onQuit = func() {
		closeViews()
		systray.Quit()
	}
	systray.SetIcon(trayIcon)
	systray.SetTooltip("hesh-ups " + version)
	mComposer := systray.AddMenuItem("Composer", "Open composer")
	setMenuIcon(mComposer, "layout-board")
	mComposerWin := mComposer.AddSubMenuItem("Open window", "Open composer WebView")
	setMenuIcon(mComposerWin, "app-window")
	mComposerWeb := mComposer.AddSubMenuItem("Open in browser", "Open composer in browser")
	setMenuIcon(mComposerWeb, "world")
	mOverlay := systray.AddMenuItem("Overlay preview", "Open overlay")
	setMenuIcon(mOverlay, "stack-2")
	mOverlayWin := mOverlay.AddSubMenuItem("Open window", "Open overlay WebView")
	setMenuIcon(mOverlayWin, "app-window")
	mOverlayWeb := mOverlay.AddSubMenuItem("Open in browser", "Open overlay in browser")
	setMenuIcon(mOverlayWeb, "world")
	mOBS := systray.AddMenuItem("OBS: disconnected", "")
	setMenuIcon(mOBS, "video-off")
	mOBS.Disable()
	mAuto := systray.AddMenuItemCheckbox("Run at login", "", s.setting("autostart") == "1")
	setMenuIcon(mAuto, "login-2")
	mData := systray.AddMenuItem("Open data folder", "")
	setMenuIcon(mData, "folder")
	mQuit := systray.AddMenuItem("Exit", "")
	setMenuIcon(mQuit, "logout")
	base := "http://" + s.setting("bind") + ":" + s.setting("port")
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		last := false
		first := true
		for range t.C {
			on := s.obs.connected()
			if on {
				mOBS.SetTitle("OBS: connected")
			} else {
				mOBS.SetTitle("OBS: disconnected")
			}
			if first || on != last {
				if on {
					setMenuIcon(mOBS, "video")
				} else {
					setMenuIcon(mOBS, "video-off")
				}
				last = on
				first = false
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
				closeViews()
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

func closeViews() {
	viewMu.Lock()
	cvs := []webview2.WebView{composerWV, overlayWV}
	viewMu.Unlock()
	for _, wv := range cvs {
		if wv == nil {
			continue
		}
		w := wv
		w.Dispatch(func() { w.Terminate() })
	}
}

func openView(title, url string, w, h int) {
	wv := webview2.New(false)
	if wv == nil {
		messageBox("hesh-ups", "WebView2 is required.")
		os.Exit(1)
	}
	wv.SetTitle(title)
	wv.SetSize(w, h, webview2.HintNone)
	viewMu.Lock()
	if title == "Composer" {
		composerWV = wv
	} else {
		overlayWV = wv
	}
	viewMu.Unlock()
	wv.Navigate(url)
	wv.Run()
	viewMu.Lock()
	if title == "Composer" {
		composerWV = nil
	} else {
		overlayWV = nil
	}
	viewMu.Unlock()
	wv.Destroy()
}

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}
