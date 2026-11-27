(function () {
  var state = { canvas: { w: 1920, h: 1080 }, slots: [], obs: { connected: false, scenes: [] } };
  var sel = null;
  var drag = null;
  var stage = document.getElementById("stage");
  var boxes = document.getElementById("boxes");
  var grid = document.getElementById("grid");
  var list = document.getElementById("layer-list");
  var inspector = document.getElementById("inspector");
  var hint = document.getElementById("empty-hint");

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="icons.svg#tabler-' + name + '"></use></svg>';
  }

  function kindIcon(s) {
    if (s.media_kind === "image" || s.media_kind === "gif") return "photo";
    if (s.media_kind === "video") return "movie";
    if (s.media_kind === "audio") return "volume";
    return "letter-t";
  }

  function setObsPill(connected) {
    var el = document.getElementById("obs-pill");
    el.className = "pill" + (connected ? " on" : "");
    el.innerHTML = icon(connected ? "video" : "video-off") + (connected ? " OBS: connected" : " OBS: disconnected");
  }

  function origin() {
    return location.origin;
  }

  function pointerToCanvas(ev) {
    var r = stage.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((ev.clientX - r.left) / r.width) * state.canvas.w,
      y: ((ev.clientY - r.top) / r.height) * state.canvas.h,
    };
  }

  function slotById(id) {
    return state.slots.filter(function (s) { return s.id === id; })[0];
  }

  function load() {
    return fetch("/api/state").then(function (r) { return r.json(); }).then(function (s) {
      state = s;
      render();
    });
  }

  function saveSlot(slot) {
    return fetch("/api/slots/" + encodeURIComponent(slot.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slot),
    }).then(function (r) { return r.json(); }).then(load);
  }

  function paintGrid() {
    var w = state.canvas.w, h = state.canvas.h;
    grid.setAttribute("viewBox", "0 0 " + w + " " + h);
    var lines = [];
    var flags = (document.getElementById("grid-thirds").checked ? "thirds," : "") +
      (document.getElementById("grid-center").checked ? "center," : "") +
      (document.getElementById("grid-safe").checked ? "safe" : "");
    function line(x1, y1, x2, y2) {
      lines.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(0,255,255,0.45)" stroke-width="2"/>');
    }
    if (flags.indexOf("thirds") >= 0) {
      line(w / 3, 0, w / 3, h); line((2 * w) / 3, 0, (2 * w) / 3, h);
      line(0, h / 3, w, h / 3); line(0, (2 * h) / 3, w, (2 * h) / 3);
    }
    if (flags.indexOf("center") >= 0) {
      line(w / 2, 0, w / 2, h); line(0, h / 2, w, h / 2);
    }
    if (flags.indexOf("safe") >= 0) {
      var m = Math.round(h * 0.05);
      lines.push('<rect x="' + m + '" y="' + m + '" width="' + (w - 2 * m) + '" height="' + (h - 2 * m) + '" fill="none" stroke="rgba(0,255,255,0.45)"/>');
    }
    grid.innerHTML = lines.join("");
  }

  function snapVal(v, others) {
    if (!document.getElementById("snap").checked) return v;
    var best = v;
    var d = 12;
    others.forEach(function (o) {
      if (Math.abs(v - o) < d) { d = Math.abs(v - o); best = o; }
    });
    return best;
  }

  function guides() {
    var g = [0, state.canvas.w, state.canvas.w / 2, state.canvas.h, state.canvas.h / 2];
    if (document.getElementById("grid-thirds").checked) {
      g.push(state.canvas.w / 3, (2 * state.canvas.w) / 3, state.canvas.h / 3, (2 * state.canvas.h) / 3);
    }
    state.slots.forEach(function (s) {
      if (s.id === sel) return;
      g.push(s.x, s.y, s.x + s.w, s.y + s.h, s.x + s.w / 2, s.y + s.h / 2);
    });
    return g;
  }

  function render() {
    setObsPill(state.obs && state.obs.connected);
    document.getElementById("btn720").className = state.canvas.w === 1280 ? "on" : "";
    document.getElementById("btn1080").className = state.canvas.w === 1920 ? "on" : "";
    hint.style.display = state.slots.length ? "none" : "block";
    paintGrid();
    var ordered = state.slots.slice().sort(function (a, b) { return b.z - a.z; });
    list.innerHTML = "";
    ordered.forEach(function (s) {
      var li = document.createElement("li");
      if (s.id === sel) li.className = "sel";
      li.innerHTML = '<button type="button" data-eye="' + s.id + '" aria-label="toggle enabled">' + icon(s.enabled ? "eye" : "eye-off") + "</button>" + icon(kindIcon(s)) + "<span>" + s.label + "</span>";
      li.addEventListener("click", function (e) {
        if (e.target.getAttribute("data-eye")) return;
        sel = s.id;
        render();
      });
      list.appendChild(li);
    });
    boxes.innerHTML = "";
    state.slots.forEach(function (s) {
      var el = document.createElement("div");
      el.className = "box" + (s.id === sel ? " sel" : "");
      el.style.left = (s.x / state.canvas.w * 100) + "%";
      el.style.top = (s.y / state.canvas.h * 100) + "%";
      el.style.width = (s.w / state.canvas.w * 100) + "%";
      el.style.height = (s.h / state.canvas.h * 100) + "%";
      el.dataset.id = s.id;
      if (s.media_kind === "image" || s.media_kind === "gif") {
        var img = document.createElement("img");
        img.src = "/media/" + s.media_path;
        el.appendChild(img);
      }
      var lab = document.createElement("span");
      lab.textContent = s.label;
      el.appendChild(lab);
      if (s.id === sel) {
        ["n", "s", "e", "w", "nw", "ne", "sw", "se"].forEach(function (h) {
          var hd = document.createElement("div");
          hd.className = "handle " + h;
          hd.dataset.handle = h;
          el.appendChild(hd);
        });
      }
      boxes.appendChild(el);
    });
    paintInspector();
  }

  function paintInspector() {
    var s = slotById(sel);
    if (!s) {
      inspector.innerHTML = '<p class="muted">Select a slot</p>';
      return;
    }
    inspector.innerHTML =
      '<label>id <input id="f-id" value="' + s.id + '"></label>' +
      '<label>label <input id="f-label" value="' + (s.label || "") + '"></label>' +
      '<label>x <input id="f-x" type="number" value="' + s.x + '"></label>' +
      '<label>y <input id="f-y" type="number" value="' + s.y + '"></label>' +
      '<label>w <input id="f-w" type="number" value="' + s.w + '"></label>' +
      '<label>h <input id="f-h" type="number" value="' + s.h + '"></label>' +
      '<label>z <input id="f-z" type="number" value="' + s.z + '"></label>' +
      '<label>media_kind <select id="f-kind"><option>none</option><option>image</option><option>gif</option><option>video</option><option>audio</option></select></label>' +
      '<label>file <input id="f-file" type="file"></label>' +
      '<label>existing <select id="f-media"></select></label>' +
      '<label>text_template <textarea id="f-text">' + (s.text_template || "") + "</textarea></label>" +
      '<label>playback <select id="f-play"><option>once</option><option>loop</option></select></label>' +
      '<label>duration_ms <input id="f-dur" type="number" value="' + (s.duration_ms == null ? "" : s.duration_ms) + '"></label>' +
      '<label>volume <input id="f-vol" type="number" min="0" max="100" value="' + s.volume + '"></label>' +
      '<label>css_class <input id="f-css" value="' + (s.css_class || "") + '"></label>' +
      '<p><button type="button" id="f-save">' + icon("device-floppy") + " Save</button> <button type="button" id="f-test">' + icon("player-play") + " Test</button> <button type="button" id="f-copy">' + icon("link") + " Copy trigger URL</button> <button type="button" id="f-del">' + icon("trash") + " Trash</button></p>" +
      '<label>OBS host <input id="obs-host"></label>' +
      '<label>OBS port <input id="obs-port"></label>' +
      '<label>OBS password <input id="obs-pass" type="password"></label>' +
      '<label>source name <input id="obs-src"></label>' +
      '<p><button type="button" id="obs-browser">' + icon("browser") + " Create/update Browser Source</button></p>" +
      '<label>scene <select id="obs-scene"></select></label>' +
      '<p><button type="button" id="obs-switch">' + icon("layers-intersect") + " Switch scene</button></p>" +
      '<label><input type="checkbox" id="autostart"> Run at login</label>';
    document.getElementById("f-kind").value = s.media_kind;
    document.getElementById("f-play").value = s.playback;
    fetch("/api/media").then(function (r) { return r.json(); }).then(function (m) {
      var selEl = document.getElementById("f-media");
      if (!selEl) return;
      selEl.innerHTML = '<option value="">(pick)</option>';
      (m.files || []).forEach(function (f) {
        var o = document.createElement("option");
        o.value = f.path;
        o.textContent = f.path;
        if (f.path === s.media_path) o.selected = true;
        selEl.appendChild(o);
      });
    });
    fetch("/api/obs/scenes").then(function (r) { return r.json(); }).then(function (o) {
      var sc = document.getElementById("obs-scene");
      if (!sc) return;
      (o.scenes || []).forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === o.current_scene) opt.selected = true;
        sc.appendChild(opt);
      });
    }).catch(function () {});
    fetch("/api/state").then(function (r) { return r.json(); }).then(function () {
      return fetch("/api/settings-dump").catch(function () { return { ok: false }; });
    });
  }

  function readForm(s) {
    var dur = document.getElementById("f-dur").value;
    var nid = document.getElementById("f-id").value.trim();
    if (nid !== s.id) {
      if (!confirm("Changing id creates a new slot; the old URL will 404. Continue?")) return null;
    }
    return {
      id: nid,
      label: document.getElementById("f-label").value,
      x: +document.getElementById("f-x").value,
      y: +document.getElementById("f-y").value,
      w: +document.getElementById("f-w").value,
      h: +document.getElementById("f-h").value,
      z: +document.getElementById("f-z").value,
      media_kind: document.getElementById("f-kind").value,
      media_path: document.getElementById("f-media").value || s.media_path || "",
      text_template: document.getElementById("f-text").value,
      playback: document.getElementById("f-play").value,
      duration_ms: dur === "" ? null : +dur,
      volume: +document.getElementById("f-vol").value,
      css_class: document.getElementById("f-css").value,
      enabled: s.enabled,
    };
  }

  inspector.addEventListener("click", function (e) {
    var s = slotById(sel);
    if (!s) return;
    var btn = e.target.closest("button");
    var id = btn ? btn.id : e.target.id;
    if (id === "f-save") {
      var body = readForm(s);
      if (!body) return;
      if (body.id !== s.id) {
        fetch("/api/slots/" + encodeURIComponent(body.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function () { return fetch("/api/slots/" + encodeURIComponent(s.id), { method: "DELETE" }); })
          .then(function () { sel = body.id; return load(); });
        return;
      }
      saveSlot(body);
    }
    if (id === "f-test") {
      fetch("/api/popup/" + encodeURIComponent(s.id) + "?user=Ada", { method: "POST" });
    }
    if (id === "f-copy") {
      navigator.clipboard.writeText(origin() + "/api/popup/" + encodeURIComponent(s.id));
    }
    if (id === "f-del") {
      fetch("/api/slots/" + encodeURIComponent(s.id), { method: "DELETE" }).then(function () { sel = null; return load(); });
    }
    if (id === "obs-browser") {
      fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        obs_host: document.getElementById("obs-host").value,
        obs_port: document.getElementById("obs-port").value,
        obs_password: document.getElementById("obs-pass").value,
        obs_browser_source: document.getElementById("obs-src").value,
      }) }).then(function () { return fetch("/api/obs/browser-source", { method: "POST" }); });
    }
    if (id === "obs-switch") {
      var name = document.getElementById("obs-scene").value;
      fetch("/api/obs/scene/" + encodeURIComponent(name), { method: "POST" });
    }
  });
  inspector.addEventListener("change", function (e) {
    if (e.target.id === "f-file" && e.target.files[0]) {
      var fd = new FormData();
      fd.append("file", e.target.files[0]);
      fetch("/api/media", { method: "POST", body: fd }).then(function (r) { return r.json(); }).then(function (m) {
        var s = slotById(sel);
        if (!s) return;
        s.media_path = m.path;
        s.media_kind = m.kind;
        return saveSlot(s);
      });
    }
    if (e.target.id === "autostart") {
      fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autostart: e.target.checked ? "1" : "0" }) });
    }
  });

  list.addEventListener("click", function (e) {
    var eye = e.target.closest("[data-eye]");
    var id = eye && eye.getAttribute("data-eye");
    if (!id) return;
    var s = slotById(id);
    s.enabled = !s.enabled;
    saveSlot(s);
  });

  document.getElementById("add-slot").addEventListener("click", function () {
    var n = 1;
    while (slotById("slot-" + n)) n++;
    var id = "slot-" + n;
    fetch("/api/slots/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: id, label: "New slot", x: 80, y: 80, w: 320, h: 180, z: n,
        media_kind: "none", media_path: "", text_template: "New slot", playback: "once",
        duration_ms: null, volume: 100, enabled: true, css_class: "",
      }),
    }).then(function () { sel = id; return load(); });
  });

  document.getElementById("copy-overlay").addEventListener("click", function () {
    navigator.clipboard.writeText(origin() + "/overlay/");
  });
  document.getElementById("btn720").addEventListener("click", function () {
    fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canvas_w: "1280", canvas_h: "720" }) }).then(load);
  });
  document.getElementById("btn1080").addEventListener("click", function () {
    fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canvas_w: "1920", canvas_h: "1080" }) }).then(load);
  });
  ["grid-thirds", "grid-center", "grid-safe", "snap"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      var g = [];
      if (document.getElementById("grid-thirds").checked) g.push("thirds");
      if (document.getElementById("grid-center").checked) g.push("center");
      if (document.getElementById("grid-safe").checked) g.push("safe");
      fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        composer_grid: g.length ? g.join(",") : "off",
        composer_snap: document.getElementById("snap").checked ? "1" : "0",
      }) });
      paintGrid();
    });
  });

  boxes.addEventListener("pointerdown", function (ev) {
    var t = ev.target;
    var box = t.closest(".box");
    if (!box) return;
    sel = box.dataset.id;
    var s = slotById(sel);
    var p = pointerToCanvas(ev);
    drag = {
      handle: t.dataset.handle || "move",
      x: s.x, y: s.y, w: s.w, h: s.h,
      px: p.x, py: p.y,
    };
    box.setPointerCapture(ev.pointerId);
    render();
  });
  boxes.addEventListener("pointermove", function (ev) {
    if (!drag) return;
    var s = slotById(sel);
    if (!s) return;
    var p = pointerToCanvas(ev);
    var dx = p.x - drag.px, dy = p.y - drag.py;
    var x = drag.x, y = drag.y, w = drag.w, h = drag.h;
    var hdl = drag.handle;
    if (hdl === "move") { x += dx; y += dy; }
    if (hdl.indexOf("w") >= 0 && hdl !== "move") { x += dx; w -= dx; }
    if (hdl.indexOf("e") >= 0) { w += dx; }
    if (hdl.indexOf("n") >= 0 && hdl !== "move") { y += dy; h -= dy; }
    if (hdl.indexOf("s") >= 0) { h += dy; }
    w = Math.max(32, w); h = Math.max(32, h);
    var g = guides();
    x = snapVal(x, g); y = snapVal(y, g);
    x = Math.max(0, Math.min(state.canvas.w - w, x));
    y = Math.max(0, Math.min(state.canvas.h - h, y));
    s.x = Math.round(x); s.y = Math.round(y); s.w = Math.round(w); s.h = Math.round(h);
    var fx = document.getElementById("f-x");
    if (fx) {
      document.getElementById("f-x").value = s.x;
      document.getElementById("f-y").value = s.y;
      document.getElementById("f-w").value = s.w;
      document.getElementById("f-h").value = s.h;
    }
    var el = boxes.querySelector('.box[data-id="' + s.id + '"]');
    if (el) {
      el.style.left = (s.x / state.canvas.w * 100) + "%";
      el.style.top = (s.y / state.canvas.h * 100) + "%";
      el.style.width = (s.w / state.canvas.w * 100) + "%";
      el.style.height = (s.h / state.canvas.h * 100) + "%";
    }
  });
  boxes.addEventListener("pointerup", function () {
    if (!drag) return;
    var s = slotById(sel);
    drag = null;
    if (s) saveSlot(s);
  });

  load().then(function () {
    setInterval(function () {
      fetch("/api/state").then(function (r) { return r.json(); }).then(function (s) {
        setObsPill(s.obs && s.obs.connected);
      });
    }, 2000);
  });
})();
