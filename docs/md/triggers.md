# Triggers

Open from the tray (WebView or system browser): `http://127.0.0.1:18745/triggers/`.

This is the operate list: every **top-level** slot (a group is one row). It is not the composer plot. Lay out boxes in [composer.md](composer.md); fire them here or from Streamer.bot / Stream Deck using the copied URLs.

- **Fire** hits the same popup URL as production, with sample `{user}` → Ada (same as composer **Test**). Retrigger while live restarts the slot.
- **Hide** / **Show** is a toggle: live → hide, idle → same fire as Fire. Header **Hide all** / **Show all** does that for every enabled top-level slot (any live → hide all; none live → fire all).
- **Copy fire URL** / **Copy hide URL** paste into Streamer.bot or Stream Deck HTTP. If a fire token is set, the copied URL includes `?token=`. The paste does not include `user=Ada` — that is Test only.
- Green live mark = that slot is on air. Disabled slots stay on the list, dimmed; fire 404s until the composer eye is on.
- Group members are not rows. Fire the group id.

See [http.md](http.md) for query keys (`user`, `amount`, `duration_ms`, …).
