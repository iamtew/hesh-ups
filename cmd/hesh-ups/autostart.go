package main

import (
	"os"
	"syscall"
	"unsafe"
)

func setAutostart(on bool) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	key := syscall.StringToUTF16Ptr(`Software\Microsoft\Windows\CurrentVersion\Run`)
	name := syscall.StringToUTF16Ptr("hesh-ups")
	var h syscall.Handle
	adv := syscall.NewLazyDLL("advapi32.dll")
	open := adv.NewProc("RegOpenKeyExW")
	set := adv.NewProc("RegSetValueExW")
	del := adv.NewProc("RegDeleteValueW")
	closek := adv.NewProc("RegCloseKey")
	r, _, _ := open.Call(uintptr(0x80000001), uintptr(unsafe.Pointer(key)), 0, uintptr(0x20006), uintptr(unsafe.Pointer(&h)))
	if r != 0 {
		return
	}
	defer closek.Call(uintptr(h))
	if on {
		val := syscall.StringToUTF16(exe)
		set.Call(uintptr(h), uintptr(unsafe.Pointer(name)), 0, 1, uintptr(unsafe.Pointer(&val[0])), uintptr(len(val)*2))
	} else {
		del.Call(uintptr(h), uintptr(unsafe.Pointer(name)))
	}
}
