(function (w) {
  function applyLook(host, look) {
    var t = host.querySelector(".banner-text");
    if (!t) return;
    look = look || {};
    var size = look.font_size || 24;
    var weight = look.font_weight || 600;
    var fill = look.fill || "#ffffff";
    var stroke = look.stroke || "#111111";
    var sw = look.stroke_w != null ? look.stroke_w : 3;
    var align = look.align || "center";
    var fit = look.fit || "shrink";
    t.style.fontWeight = String(weight);
    t.style.fontSize = size + "px";
    t.style.color = fill;
    t.style.webkitTextStroke = sw ? sw + "px " + stroke : "0";
    t.style.paintOrder = "stroke fill";
    t.style.textAlign = align;
    t.style.overflow = "hidden";
    var wrap = host.querySelector(".banner-content");
    if (wrap) {
      wrap.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
      wrap.style.alignItems = "center";
    }
    if (fit === "ellipsis") {
      t.style.whiteSpace = "nowrap";
      t.style.textOverflow = "ellipsis";
      t.style.height = "auto";
      t.style.maxHeight = "100%";
      return;
    }
    t.style.textOverflow = "clip";
    t.style.whiteSpace = "normal";
    t.style.height = "100%";
    if (fit !== "shrink") return;
    var fs = size;
    t.style.fontSize = fs + "px";
    while (fs > 8 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1)) {
      fs--;
      t.style.fontSize = fs + "px";
    }
  }
  w.applyLook = applyLook;
})(window);
