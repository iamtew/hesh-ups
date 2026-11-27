# Credits

Third-party files checked into this repo. No CDN at runtime.

## Tabler Icons

[Tabler Icons](https://tabler.io/icons) v3.35.0, MIT. Copyright (c) 2020-2025 Paweł Kuna.

Outline subset only (not the full set). Sprite: [vendor/tabler/icons.svg](../vendor/tabler/icons.svg). License: [vendor/tabler/LICENSE](../vendor/tabler/LICENSE). Composer embeds a copy at `cmd/hesh-ups/web/composer/icons.svg`. Tray menu uses 16/32px `.ico` rasters of the same glyphs in `cmd/hesh-ups/icons/` (dark stroke on opaque white; systray draws menu icons without alpha, so transparent pixels become black blocks).

`layers` is not in this pin; overlay/layers chrome uses `stack-2`.

## marked

[marked](https://github.com/markedjs/marked) v18.1.2, MIT. [vendor/marked.min.js](../vendor/marked.min.js) powers the Pages viewer.

## hesh-ups

Product code and docs: MIT (`LICENSE` at the repo root).
