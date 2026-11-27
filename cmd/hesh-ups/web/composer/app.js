(function () {
  var state = { canvas: { w: 1920, h: 1080 }, slots: [], obs: { connected: false, scenes: [] } };
  var sel = null;
  var drag = null;
  var gridReady = false;
  var stage = document.getElementById("stage");
  var boxes = document.getElementById("boxes");
  var grid = document.getElementById("grid");
  var list = document.getElementById("layer-list");
  var inspector = document.getElementById("inspector");
  var hint = document.getElementById("empty-hint");
  var downBanner = document.getElementById("down-banner");
  var settingsOverlay = document.getElementById("settings-overlay");
  var fileMenu = document.getElementById("file-menu");
  var btnFile = document.getElementById("btn-file");
  var token = "";
  var statusTimer = null;

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="icons.svg#tabler-' + name + '"></use></svg>';
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function kindIcon(s) {
    if (s.media_kind === "image" || s.media_kind === "gif") return "photo";
    if (s.media_kind === "video") return "movie";
    if (s.media_kind === "audio") return "volume";
    return "letter-t";
  }

  function origin() {
    return location.origin;
  }

  function setStatus(msg) {
    var el = document.getElementById("bar-status");
    el.textContent = msg || "";
    if (statusTimer) clearTimeout(statusTimer);
    if (msg) {
      statusTimer = setTimeout(function () { el.textContent = ""; }, 4000);
    }
  }

  function tokenQuery() {
    return token ? "?token=" + encodeURIComponent(token) : "";
  }

  function popupURL(id, extra) {
    var q = tokenQuery();
    if (extra) q = q ? q + "&" + extra : "?" + extra;
    return origin() + "/api/popup/" + encodeURIComponent(id) + q;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return copyFallback(text);
      });
    }
    return copyFallback(text);
  }

  function copyFallback(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        if (!document.execCommand("copy")) throw new Error("copy");
        resolve();
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(ta);
    });
  }

  function errMsg(r) {
    return r.json().then(function (e) {
      return (e && e.message) || r.statusText || "failed";
    }).catch(function () { return r.statusText || "failed"; });
  }

  function setObsPill(connected) {
    var el = document.getElementById("obs-pill");
    el.className = connected ? "up" : "";
    document.getElementById("obs-pill-text").textContent = connected ? "OBS connected" : "OBS offline";
    var st = document.getElementById("obs-status");
    if (st) st.textContent = connected ? "Connected" : "Disconnected";
  }

  function fillScenes(obs) {
    var sc = document.getElementById("obs-scene");
    var cur = sc.value;
    sc.innerHTML = "";
    (obs && obs.scenes ? obs.scenes : []).forEach(function (name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      if (name === (obs.current_scene || cur)) o.selected = true;
      sc.appendChild(o);
    });
    sc.disabled = !obs || !obs.connected;
    document.getElementById("obs-switch").disabled = sc.disabled;
  }

  function applyGridFlags(flags, snap) {
    var g = flags || "";
    document.getElementById("grid-thirds").checked = g.indexOf("thirds") >= 0;
    document.getElementById("grid-center").checked = g.indexOf("center") >= 0;
    document.getElementById("grid-safe").checked = g.indexOf("safe") >= 0;
    document.getElementById("snap").checked = snap === "1";
    gridReady = true;
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
    return fetch("/api/state").then(function (r) {
      if (!r.ok) throw new Error("down");
      downBanner.hidden = true;
      return r.json();
    }).then(function (s) {
      state = s;
      render();
    }).catch(function () {
      downBanner.hidden = false;
    });
  }

  function putSlot(slot) {
    return fetch("/api/slots/" + encodeURIComponent(slot.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slot),
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) {
          var msg = (body && body.message) || "Save failed";
          setStatus(msg);
          var err = new Error(msg);
          err.save = true;
          throw err;
        }
        return body;
      });
    });
  }

  function saveSlot(slot) {
    return putSlot(slot).then(load);
  }

  function persist(old, body) {
    return putSlot(body).then(function () {
      if (body.id === old.id) return;
      return fetch("/api/slots/" + encodeURIComponent(old.id), { method: "DELETE" });
    }).then(function () {
      sel = body.id;
      return load();
    });
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

  function axisGuides(horizontal) {
    var w = state.canvas.w, h = state.canvas.h;
    var g = horizontal ? [0, w, w / 2] : [0, h, h / 2];
    if (document.getElementById("grid-thirds").checked) {
      if (horizontal) g.push(w / 3, (2 * w) / 3);
      else g.push(h / 3, (2 * h) / 3);
    }
    if (document.getElementById("grid-safe").checked) {
      var m = Math.round(h * 0.05);
      if (horizontal) g.push(m, w - m);
      else g.push(m, h - m);
    }
    state.slots.forEach(function (s) {
      if (s.id === sel) return;
      if (horizontal) g.push(s.x, s.x + s.w, s.x + s.w / 2);
      else g.push(s.y, s.y + s.h, s.y + s.h / 2);
    });
    return g;
  }

  function snapEdge(pos, size, guides) {
    if (!document.getElementById("snap").checked) return pos;
    var best = pos;
    var d = 12;
    function consider(edge) {
      guides.forEach(function (g) {
        var delta = Math.abs(edge - g);
        if (delta < d) {
          d = delta;
          best = pos + (g - edge);
        }
      });
    }
    consider(pos);
    consider(pos + size);
    return best;
  }

  function placeBox(el, s) {
    el.style.left = (s.x / state.canvas.w * 100) + "%";
    el.style.top = (s.y / state.canvas.h * 100) + "%";
    el.style.width = (s.w / state.canvas.w * 100) + "%";
    el.style.height = (s.h / state.canvas.h * 100) + "%";
    el.style.zIndex = String(s.z || 0);
  }

  function previewText(tmpl) {
    var filled = String(tmpl || "").replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function (_, name) {
      return name === "user" ? "Ada" : "";
    });
    return esc(filled);
  }

  function fillBox(el, s) {
    el.className = "box" + (s.id === sel ? " sel" : "") + (s.visible ? " live" : "");
    if (s.css_class) el.className += " " + s.css_class;
    el.querySelectorAll("img, video, .text").forEach(function (n) { n.remove(); });
    var before = el.querySelector(".handle");
    function add(node) {
      if (before) el.insertBefore(node, before);
      else el.appendChild(node);
    }
    if (s.media_kind === "image" || s.media_kind === "gif") {
      var img = document.createElement("img");
      img.src = "/media/" + s.media_path;
      add(img);
    } else if (s.media_kind === "video" && s.media_path) {
      var v = document.createElement("video");
      v.muted = true;
      v.autoplay = true;
      v.src = "/media/" + s.media_path;
      if (s.playback === "loop") v.loop = true;
      add(v);
    }
    if (s.text_template) {
      var t = document.createElement("div");
      t.className = "text";
      t.innerHTML = previewText(s.text_template);
      add(t);
    }
  }

  function applyInspectorPreview() {
    var s = slotById(sel);
    if (!s || !document.getElementById("f-x")) return;
    var w = Math.max(32, +document.getElementById("f-w").value || 0);
    var h = Math.max(32, +document.getElementById("f-h").value || 0);
    var x = +document.getElementById("f-x").value || 0;
    var y = +document.getElementById("f-y").value || 0;
    x = Math.max(0, Math.min(state.canvas.w - w, x));
    y = Math.max(0, Math.min(state.canvas.h - h, y));
    s.x = Math.round(x);
    s.y = Math.round(y);
    s.w = Math.round(w);
    s.h = Math.round(h);
    s.z = Math.round(+document.getElementById("f-z").value || 0);
    s.label = document.getElementById("f-label").value;
    var ft = document.getElementById("f-text");
    if (ft) s.text_template = ft.value;
    var el = boxes.querySelector('.box[data-id="' + s.id + '"]');
    if (el) {
      placeBox(el, s);
      var t = el.querySelector(".text");
      if (s.text_template) {
        if (!t) {
          t = document.createElement("div");
          t.className = "text";
          var hd = el.querySelector(".handle");
          if (hd) el.insertBefore(t, hd);
          else el.appendChild(t);
        }
        t.innerHTML = previewText(s.text_template);
      } else if (t) {
        t.remove();
      }
    }
    var li = list.querySelector('li[data-id="' + s.id + '"]');
    if (li) {
      var sp = li.querySelector("span");
      if (sp) sp.textContent = s.label || s.id;
    }
  }

  function render() {
    setObsPill(state.obs && state.obs.connected);
    fillScenes(state.obs);
    document.getElementById("btn720").className = state.canvas.w === 1280 ? "sel" : "";
    document.getElementById("btn1080").className = state.canvas.w === 1920 ? "sel" : "";
    hint.style.display = state.slots.length ? "none" : "block";
    stage.style.setProperty("--canvas-h", String(state.canvas.h));
    paintGrid();
    var ordered = state.slots.slice().sort(function (a, b) { return b.z - a.z; });
    list.innerHTML = "";
    ordered.forEach(function (s) {
      var li = document.createElement("li");
      if (s.id === sel) li.className = "sel";
      li.dataset.id = s.id;
      if (s.visible) li.className = (li.className ? li.className + " " : "") + "live";
      li.innerHTML = '<button type="button" data-eye="' + esc(s.id) + '" aria-label="toggle enabled">' + icon(s.enabled ? "eye" : "eye-off") + "</button>" + icon(kindIcon(s)) + "<span></span>";
      li.querySelector("span").textContent = s.label || s.id;
      li.addEventListener("click", function (e) {
        if (e.target.closest("[data-eye]")) return;
        sel = s.id;
        render();
      });
      list.appendChild(li);
    });
    boxes.innerHTML = "";
    state.slots.forEach(function (s) {
      var el = document.createElement("div");
      el.dataset.id = s.id;
      placeBox(el, s);
      fillBox(el, s);
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
      '<label>id <input id="f-id" value="' + esc(s.id) + '"></label>' +
      '<label>label <input id="f-label" value="' + esc(s.label || "") + '"></label>' +
      '<label>x <input id="f-x" type="number" value="' + s.x + '"></label>' +
      '<label>y <input id="f-y" type="number" value="' + s.y + '"></label>' +
      '<label>w <input id="f-w" type="number" value="' + s.w + '"></label>' +
      '<label>h <input id="f-h" type="number" value="' + s.h + '"></label>' +
      '<label>z <input id="f-z" type="number" value="' + s.z + '"></label>' +
      '<label>media_kind <select id="f-kind"><option>none</option><option>image</option><option>gif</option><option>video</option><option>audio</option></select></label>' +
      '<label>file <input id="f-file" type="file"></label>' +
      '<label>existing <select id="f-media"></select></label>' +
      '<label>text_template <textarea id="f-text">' + esc(s.text_template || "") + "</textarea></label>" +
      '<label>playback <select id="f-play"><option>once</option><option>loop</option></select></label>' +
      '<label>duration_ms <input id="f-dur" type="number" min="0" placeholder="blank = sticky" value="' + (s.duration_ms == null ? "" : s.duration_ms) + '"></label>' +
      '<p class="muted">Blank duration stays on until Hide. Default for new slots is 5000.</p>' +
      '<label>volume <input id="f-vol" type="number" min="0" max="100" value="' + s.volume + '"></label>' +
      '<label>css_class <input id="f-css" value="' + esc(s.css_class || "") + '"></label>' +
      '<p><button type="button" id="f-save">' + icon("device-floppy") + ' Save</button> ' +
      '<button type="button" id="f-test">' + icon("player-play") + ' Test</button> ' +
      '<button type="button" id="f-hide">' + icon("eye-off") + ' Hide</button> ' +
      '<button type="button" id="f-copy">' + icon("link") + ' Copy trigger URL</button> ' +
      '<button type="button" id="f-del">' + icon("trash") + ' Trash</button></p>';
    document.getElementById("f-kind").value = s.media_kind;
    document.getElementById("f-play").value = s.playback;
    fetch("/api/media").then(function (r) { return r.json(); }).then(function (m) {
      var selEl = document.getElementById("f-media");
      if (!selEl) return;
      selEl.innerHTML = '<option value="">(pick)</option>';
      (m.files || []).forEach(function (f) {
        var o = document.createElement("option");
        o.value = f.path;
        o.dataset.kind = f.kind || "";
        o.textContent = f.path;
        if (f.path === s.media_path) o.selected = true;
        selEl.appendChild(o);
      });
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

  function showSettingsPage(name) {
    document.querySelectorAll(".settings-nav button").forEach(function (b) {
      b.classList.toggle("sel", b.dataset.set === name);
    });
    document.getElementById("set-obs").hidden = name !== "obs";
    document.getElementById("set-app").hidden = name !== "app";
  }

  function fillSettings(kv) {
    document.getElementById("obs-host").value = kv.obs_host || "";
    document.getElementById("obs-port").value = kv.obs_port || "";
    document.getElementById("obs-pass").value = kv.obs_password || "";
    document.getElementById("obs-src").value = kv.obs_browser_source || "";
    document.getElementById("autostart").checked = kv.autostart === "1";
    document.getElementById("app-token").value = kv.token || "";
    document.getElementById("obs-msg").textContent = "";
    token = kv.token || "";
    if (!gridReady) applyGridFlags(kv.composer_grid, kv.composer_snap);
  }

  function settingsPayload() {
    return {
      obs_host: document.getElementById("obs-host").value,
      obs_port: document.getElementById("obs-port").value,
      obs_password: document.getElementById("obs-pass").value,
      obs_browser_source: document.getElementById("obs-src").value,
      autostart: document.getElementById("autostart").checked ? "1" : "0",
      token: document.getElementById("app-token").value,
    };
  }

  function saveSettings() {
    return fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsPayload()),
    });
  }

  function openSettings(page) {
    fileMenu.hidden = true;
    showSettingsPage(page || "obs");
    settingsOverlay.hidden = false;
    fetch("/api/settings").then(function (r) {
      if (!r.ok) throw new Error("settings");
      return r.json();
    }).then(function (kv) {
      fillSettings(kv);
    }).catch(function () {
      setStatus("Could not load settings");
    });
  }

  function closeSettings() {
    if (settingsOverlay.hidden) return;
    saveSettings().then(function () {
      token = document.getElementById("app-token").value;
      settingsOverlay.hidden = true;
      load();
    });
  }

  inspector.addEventListener("click", function (e) {
    var s = slotById(sel);
    if (!s) return;
    var btn = e.target.closest("button");
    var id = btn ? btn.id : e.target.id;
    if (id === "f-save") {
      var body = readForm(s);
      if (!body) return;
      persist(s, body).catch(function () {});
    }
    if (id === "f-test") {
      var fired = readForm(s);
      if (!fired) return;
      persist(s, fired).then(function () {
        return fetch(popupURL(fired.id, "user=Ada"), { method: "POST" });
      }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        var sticky = (fired.duration_ms == null || fired.duration_ms <= 0) && fired.media_kind !== "video" && fired.media_kind !== "audio";
        setStatus(sticky ? "Fired (sticky — Hide to stop)" : "Fired " + fired.id);
      }).catch(function (err) {
        if (!err || !err.save) setStatus("Fire failed");
      });
    }
    if (id === "f-hide") {
      fetch(origin() + "/api/popup/" + encodeURIComponent(s.id) + "/hide" + tokenQuery(), { method: "POST" }).then(function (r) {
        if (r.ok) setStatus("Hidden " + s.id);
        else errMsg(r).then(setStatus);
      }).catch(function () { setStatus("Hide failed"); });
    }
    if (id === "f-copy") {
      copyText(popupURL(s.id)).then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
    }
    if (id === "f-del") {
      fetch("/api/slots/" + encodeURIComponent(s.id), { method: "DELETE" }).then(function () { sel = null; return load(); });
    }
  });
  inspector.addEventListener("input", function (e) {
    var id = e.target.id;
    if (id === "f-x" || id === "f-y" || id === "f-w" || id === "f-h" || id === "f-z" || id === "f-label" || id === "f-text") {
      applyInspectorPreview();
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
      return;
    }
    if (e.target.id === "f-media" && e.target.value) {
      var s = slotById(sel);
      if (!s) return;
      s.media_path = e.target.value;
      var opt = e.target.selectedOptions && e.target.selectedOptions[0];
      if (opt && opt.dataset.kind) s.media_kind = opt.dataset.kind;
      saveSlot(s);
      return;
    }
    if (e.target.id === "f-id") return;
    var persist = { "f-x": 1, "f-y": 1, "f-w": 1, "f-h": 1, "f-z": 1, "f-label": 1, "f-kind": 1, "f-text": 1, "f-play": 1, "f-dur": 1, "f-vol": 1, "f-css": 1 };
    if (!persist[e.target.id]) return;
    var s = slotById(sel);
    if (!s) return;
    applyInspectorPreview();
    s.media_kind = document.getElementById("f-kind").value;
    s.text_template = document.getElementById("f-text").value;
    s.playback = document.getElementById("f-play").value;
    var dur = document.getElementById("f-dur").value;
    s.duration_ms = dur === "" ? null : +dur;
    s.volume = +document.getElementById("f-vol").value;
    s.css_class = document.getElementById("f-css").value;
    saveSlot(s);
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
        duration_ms: 5000, volume: 100, enabled: true, css_class: "",
      }),
    }).then(function () { sel = id; return load(); });
  });

  document.getElementById("copy-overlay").addEventListener("click", function () {
    copyText(origin() + "/overlay/").then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
  });
  document.getElementById("hide-all").addEventListener("click", function () {
    fetch(origin() + "/api/popup/hide_all" + tokenQuery(), { method: "POST" }).then(function (r) {
      if (r.ok) setStatus("Hidden all");
      else errMsg(r).then(setStatus);
    }).catch(function () { setStatus("Hide all failed"); });
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

  document.getElementById("obs-switch").addEventListener("click", function () {
    var name = document.getElementById("obs-scene").value;
    if (!name) {
      setStatus("No scene");
      return;
    }
    fetch("/api/obs/scene/" + encodeURIComponent(name) + tokenQuery(), { method: "POST" }).then(function (r) {
      if (r.ok) setStatus("Scene " + name);
      else errMsg(r).then(setStatus);
    }).catch(function () { setStatus("Scene switch failed"); });
  });
  document.getElementById("obs-pill").addEventListener("click", function () { openSettings("obs"); });
  document.getElementById("obs-browser").addEventListener("click", function () {
    saveSettings().then(function () {
      return fetch("/api/obs/browser-source", { method: "POST" });
    }).then(function (r) {
      var msg = document.getElementById("obs-msg");
      if (r.ok) {
        msg.textContent = "Browser Source created or updated.";
        return;
      }
      return r.json().then(function (e) {
        msg.textContent = (e && e.message) || "failed";
      });
    });
  });

  btnFile.addEventListener("click", function (e) {
    e.stopPropagation();
    fileMenu.hidden = !fileMenu.hidden;
    btnFile.setAttribute("aria-expanded", fileMenu.hidden ? "false" : "true");
  });
  document.getElementById("file-settings").addEventListener("click", function () { openSettings("obs"); });
  document.getElementById("file-help").addEventListener("click", function () {
    fileMenu.hidden = true;
    fetch("/api/help", { method: "POST" }).catch(function () {});
  });
  document.getElementById("file-close").addEventListener("click", function () {
    fileMenu.hidden = true;
    fetch("/api/view/close", { method: "POST" }).finally(function () { window.close(); });
  });
  document.getElementById("file-quit").addEventListener("click", function () {
    fetch("/api/quit", { method: "POST" }).catch(function () {});
  });
  document.querySelectorAll(".settings-nav button").forEach(function (b) {
    b.addEventListener("click", function () { showSettingsPage(b.dataset.set); });
  });
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", function (e) {
    if (e.target === settingsOverlay) closeSettings();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSettings();
  });
  document.addEventListener("click", function () {
    fileMenu.hidden = true;
    btnFile.setAttribute("aria-expanded", "false");
  });
  fileMenu.addEventListener("click", function (e) { e.stopPropagation(); });

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
    if (hdl === "move") {
      x += dx; y += dy;
    } else {
      if (hdl.indexOf("w") >= 0) { x += dx; w -= dx; }
      if (hdl.indexOf("e") >= 0) { w += dx; }
      if (hdl.indexOf("n") >= 0) { y += dy; h -= dy; }
      if (hdl.indexOf("s") >= 0) { h += dy; }
    }
    w = Math.max(32, w); h = Math.max(32, h);
    var gx = axisGuides(true), gy = axisGuides(false);
    if (hdl === "move") {
      x = snapEdge(x, w, gx);
      y = snapEdge(y, h, gy);
    } else {
      if (hdl.indexOf("w") >= 0) x = snapVal(x, gx);
      if (hdl.indexOf("e") >= 0) w = Math.max(32, snapVal(x + w, gx) - x);
      if (hdl.indexOf("n") >= 0) y = snapVal(y, gy);
      if (hdl.indexOf("s") >= 0) h = Math.max(32, snapVal(y + h, gy) - y);
    }
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
    if (el) placeBox(el, s);
  });
  boxes.addEventListener("pointerup", function () {
    if (!drag) return;
    var s = slotById(sel);
    drag = null;
    if (s) saveSlot(s);
  });

  fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) {
    document.getElementById("file-version").textContent = h.version || "";
  }).catch(function () {});
  fetch("/api/settings").then(function (r) { return r.json(); }).then(function (kv) {
    fillSettings(kv);
    return load();
  }).then(function () {
    setInterval(function () {
      fetch("/api/state").then(function (r) {
        if (!r.ok) throw new Error("down");
        downBanner.hidden = true;
        return r.json();
      }).then(function (s) {
        state.obs = s.obs;
        (s.slots || []).forEach(function (sl) {
          var cur = slotById(sl.id);
          if (cur) cur.visible = !!sl.visible;
        });
        document.querySelectorAll("#layer-list li, #boxes .box").forEach(function (el) {
          var cur = slotById(el.dataset.id);
          if (cur) el.classList.toggle("live", !!cur.visible);
        });
        setObsPill(s.obs && s.obs.connected);
        fillScenes(s.obs);
      }).catch(function () {
        downBanner.hidden = false;
      });
    }, 2000);
  });
})();
