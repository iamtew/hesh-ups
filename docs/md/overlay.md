# Overlay

`GET /overlay/` is a transparent page. The canvas box is canvas pixels, scaled with CSS `zoom` to fit the viewport; a matching OBS source stays 1:1 (`zoom` unset). OBS Browser Source loads it. Tray **Overlay preview** (window or browser) is the same page — program only, empty until a slot fires. The composer stage is a plot, not this page.

Slots sit at `x,y,w,h` with `z-index`. A layout save moves them on the open overlay; you do not reload the Browser Source. Show/stop arrives over WebSocket (`/ws`). Motion is CSS (~200ms): fade, slide, or scale per slot. Video, audio, and a group that contains them show immediately — opacity and transform on an ancestor blank the media element in Chromium. Audio and video play in this page unmuted at the slot volume, so OBS hears the track. If a browser blocks that, playback stays muted and the first click or key retries sound. OBS `reroute_audio` sends that into the mixer. Composer plot preview is silent on purpose. In a normal browser, click the overlay preview once if sound is blocked. Reconnect drops slots that are no longer visible.

Text slots are a banner pane (`theme`: plain or glass) with type knobs (`look`: size, fill, stroke, align, fit). Groups show their members inside the group box.

Play-once video/audio hide when the file ends (unless a duration holds the last frame). Loop repeats until hide or max duration. Sticky image/text stays until hide. A group with no duration hides when its last play-once clip ends, unless a member is set to loop.
