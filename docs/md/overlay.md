# Overlay

`GET /overlay/` is a transparent page the size of the canvas. OBS Browser Source loads it. Tray preview (window or browser) is the same page.

Slots sit at `x,y,w,h` with `z-index`. A layout save moves them on the open overlay; you do not reload the Browser Source. Show/hide arrives over WebSocket (`/ws`). Fade in/out is CSS (~200ms). Audio and video play in the page; OBS `reroute_audio` sends that into the mixer. Reconnect drops slots that are no longer visible.

Text slots are a banner pane (`theme`: plain or glass). Groups show their members inside the group box.

Play-once video/audio hide when the file ends (unless a duration holds the last frame). Loop repeats until hide or max duration. Sticky image/text stays until hide. A group with no duration hides when its last play-once clip ends, unless a member is set to loop.
