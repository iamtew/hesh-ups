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
  var inspectorActions = document.getElementById("inspector-actions");
  var hint = document.getElementById("empty-hint");
  var downBanner = document.getElementById("down-banner");
  var settingsOverlay = document.getElementById("settings-overlay");
  var fileMenu = document.getElementById("file-menu");
  var btnFile = document.getElementById("btn-file");
  var token = "";
  var statusTimer = null;
  var DEFAULT_DURATION_MS = 5000;

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="icons.svg#tabler-' + name + '"></use></svg>';
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var THEMES = [
    { id: "plain", name: "Plain" },
    { id: "lcd-glass", name: "LCD Glass" },
    { id: "sesh-glass", name: "Sesh Glass" },
    { id: "sesh-glass-old", name: "Sesh Glass Old" },
    { id: "3026-d3c0", name: "3026 D3C0" },
  ];

  function kindIcon(s) {
    if (s.media_kind === "group") return "stack-2";
    if (s.media_kind === "image" || s.media_kind === "gif") return "photo";
    if (s.media_kind === "video") return "movie";
    if (s.media_kind === "audio") return "volume";
    return "letter-t";
  }

  function fireId(s) {
    return s.parent_id || s.id;
  }

  function absRect(s) {
    if (!s.parent_id) return { x: s.x, y: s.y, w: s.w, h: s.h };
    var p = slotById(s.parent_id);
    if (!p) return { x: s.x, y: s.y, w: s.w, h: s.h };
    return { x: p.x + s.x, y: p.y + s.y, w: s.w, h: s.h };
  }

  function boundsFor(s) {
    if (s.parent_id) {
      var p = slotById(s.parent_id);
      if (p) return { w: p.w, h: p.h };
    }
    return { w: state.canvas.w, h: state.canvas.h };
  }

  function themeFx() {
    return (window.SeshThemes && window.SeshThemes.effects) || {};
  }

  function stopThemes(root) {
    var fx = themeFx();
    root.querySelectorAll(".theme-panel").forEach(function (p) {
      Object.keys(fx).forEach(function (id) {
        if (fx[id] && fx[id].stop) fx[id].stop(p);
      });
    });
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
      (s.slots || []).forEach(function (sl) {
        sl.enabled = sl.enabled !== false && sl.enabled !== 0 && sl.enabled !== "0";
      });
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

  // File length in ms, rounded up. Null when the element has no finite duration.
  function mediaDurationMs(kind, path) {
    return new Promise(function (resolve) {
      if ((kind !== "video" && kind !== "audio") || !path) {
        resolve(null);
        return;
      }
      var el = document.createElement(kind === "video" ? "video" : "audio");
      el.preload = "metadata";
      function done(ms) {
        el.removeAttribute("src");
        el.onloadedmetadata = null;
        el.onerror = null;
        resolve(ms);
      }
      el.onloadedmetadata = function () {
        var ms = Math.ceil(el.duration * 1000);
        done(isFinite(ms) && ms > 0 ? ms : null);
      };
      el.onerror = function () { done(null); };
      el.src = "/media/" + path;
    });
  }

  function assignMedia(s, path, kind) {
    s.media_path = path;
    s.media_kind = kind;
    if (s.parent_id || (kind !== "video" && kind !== "audio")) return saveSlot(s);
    return mediaDurationMs(kind, path).then(function (ms) {
      if (ms != null) s.duration_ms = ms;
      return saveSlot(s);
    });
  }

  function resetDuration(s) {
    var timed = !s.parent_id && (s.media_kind === "video" || s.media_kind === "audio") && s.media_path;
    function apply(ms) {
      s.duration_ms = ms;
      var el = document.getElementById("f-dur");
      if (el) el.value = String(ms);
      return saveSlot(s);
    }
    if (!timed) return apply(DEFAULT_DURATION_MS);
    return mediaDurationMs(s.media_kind, s.media_path).then(function (ms) {
      if (ms == null) {
        setStatus("Could not read duration");
        return;
      }
      return apply(ms);
    });
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
      var r = absRect(s);
      if (horizontal) g.push(r.x, r.x + r.w, r.x + r.w / 2);
      else g.push(r.y, r.y + r.h, r.y + r.h / 2);
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

  function isOn(s) {
    return !!s && s.enabled !== false && s.enabled !== 0 && s.enabled !== "0";
  }

  function stageShown(s) {
    if (!isOn(s)) return false;
    if (s.parent_id) return isOn(slotById(s.parent_id));
    return true;
  }

  function toggleEye(s) {
    if (!s) return;
    s.enabled = !isOn(s);
    render();
    saveSlot(s).catch(function () { load(); });
  }

  function membersOf(id) {
    return state.slots.filter(function (c) { return c.parent_id === id; }).sort(function (a, b) { return b.z - a.z; });
  }

  function placeBox(el, s) {
    if (s.parent_id) {
      var p = slotById(s.parent_id);
      var pw = (p && p.w) || 1;
      var ph = (p && p.h) || 1;
      el.style.left = (s.x / pw * 100) + "%";
      el.style.top = (s.y / ph * 100) + "%";
      el.style.width = (s.w / pw * 100) + "%";
      el.style.height = (s.h / ph * 100) + "%";
      el.style.zIndex = String(s.z || 0);
      return;
    }
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

  function slotLive(s) {
    if (!s) return false;
    if (s.visible) return true;
    var p = s.parent_id ? slotById(s.parent_id) : null;
    return !!(p && p.visible);
  }

  function slotPreview(s) {
    if (!s || !sel) return false;
    if (s.id === sel) return true;
    return !!(s.parent_id && s.parent_id === sel);
  }

  function slotFilled(s) {
    return slotLive(s) || slotPreview(s);
  }

  function paintSlot(s) {
    if (!s) return;
    var el = boxes.querySelector('.box[data-id="' + s.id + '"]');
    if (el) fillBox(el, s);
    var li = list.querySelector('li[data-id="' + s.id + '"]');
    if (li) li.classList.toggle("live", slotLive(s));
  }

  function paintSlotTree(s) {
    paintSlot(s);
    if (s && s.media_kind === "group") membersOf(s.id).forEach(paintSlot);
  }

  function fillBox(el, s) {
    stopThemes(el);
    var parent = s.parent_id ? slotById(s.parent_id) : null;
    var live = slotLive(s);
    var host = !!(sel && slotById(sel) && slotById(sel).parent_id === s.id);
    var filled = slotFilled(s);
    el.className = "box popup"
      + (s.id === sel ? " sel" : "")
      + (live ? " live" : "")
      + (filled ? " filled" : " plot")
      + (s.media_kind === "group" ? " group" : "")
      + (parent ? " child" : "")
      + (host ? " host" : "");
    el.removeAttribute("data-theme");
    el.querySelectorAll("img, video, .banner-content, .chrome-tag, .chrome-name").forEach(function (n) { n.remove(); });
    var before = el.querySelector(".handle");
    function add(node) {
      if (before) el.insertBefore(node, before);
      else el.appendChild(node);
    }
    if (filled) {
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
      } else if (s.media_kind === "text") {
        var theme = s.theme || "plain";
        el.setAttribute("data-theme", theme);
        var wrap = document.createElement("div");
        wrap.className = "banner-content" + (theme === "plain" ? "" : " theme-panel");
        var t = document.createElement("div");
        t.className = "banner-text";
        t.innerHTML = previewText(s.text_template);
        wrap.appendChild(t);
        add(wrap);
        var fx = themeFx();
        if (theme !== "plain" && fx[theme] && fx[theme].start) fx[theme].start(wrap);
        if (window.applyLook) window.applyLook(el, s.look);
      }
    }
    var name = document.createElement("div");
    name.className = "chrome-name";
    name.textContent = s.label || s.id;
    add(name);
    if (s.media_kind === "group" || parent) {
      var tag = document.createElement("div");
      tag.className = "chrome-tag";
      tag.textContent = s.media_kind === "group" ? "GROUP" : "IN " + ((parent && (parent.label || parent.id)) || s.parent_id);
      add(tag);
    }
  }

  function applyInspectorPreview() {
    var s = slotById(sel);
    if (!s || !document.getElementById("f-x")) return;
    var w = Math.max(32, +document.getElementById("f-w").value || 0);
    var h = Math.max(32, +document.getElementById("f-h").value || 0);
    var x = +document.getElementById("f-x").value || 0;
    var y = +document.getElementById("f-y").value || 0;
    var lim = boundsFor(s);
    w = Math.max(32, Math.min(w, lim.w));
    h = Math.max(32, Math.min(h, lim.h));
    x = Math.max(0, Math.min(lim.w - w, x));
    y = Math.max(0, Math.min(lim.h - h, y));
    s.x = Math.round(x);
    s.y = Math.round(y);
    s.w = Math.round(w);
    s.h = Math.round(h);
    s.z = Math.round(+document.getElementById("f-z").value || 0);
    s.label = document.getElementById("f-label").value;
    var ft = document.getElementById("f-text");
    if (ft) s.text_template = ft.value;
    var fth = document.getElementById("f-theme");
    if (fth) s.theme = fth.value;
    if (document.getElementById("f-font-size")) s.look = lookFromForm(s);
    var el = boxes.querySelector('.box[data-id="' + s.id + '"]');
    if (el) {
      placeBox(el, s);
      fillBox(el, s);
      if (s.media_kind === "group") {
        membersOf(s.id).forEach(function (c) {
          var cel = el.querySelector(':scope > .box[data-id="' + c.id + '"]');
          if (cel) {
            placeBox(cel, c);
            fillBox(cel, c);
          }
        });
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
    function layerRow(s) {
      var li = document.createElement("li");
      var cls = [];
      if (s.id === sel) cls.push("sel");
      if (s.media_kind === "group") cls.push("group");
      if (s.parent_id) cls.push("child");
      if (sel && slotById(sel) && slotById(sel).parent_id === s.id) cls.push("host");
      if (!isOn(s) || (s.parent_id && !isOn(slotById(s.parent_id)))) cls.push("off");
      li.dataset.id = s.id;
      if (slotLive(s)) cls.push("live");
      li.className = cls.join(" ");
      var row = document.createElement("div");
      row.className = "row";
      var on = isOn(s);
      row.innerHTML = '<button type="button" data-eye="' + esc(s.id) + '" aria-label="' + (on ? "disable" : "enable") + '">' + icon(on ? "eye" : "eye-off") + "</button>" + icon(kindIcon(s)) + "<span></span>";
      row.querySelector("span").textContent = s.label || s.id;
      row.addEventListener("click", function (e) {
        if (e.target.closest("[data-eye]")) {
          e.preventDefault();
          e.stopPropagation();
          toggleEye(s);
          return;
        }
        sel = s.id;
        render();
      });
      li.appendChild(row);
      if (s.media_kind === "group") {
        var sub = document.createElement("ul");
        sub.className = "members";
        membersOf(s.id).forEach(function (c) { sub.appendChild(layerRow(c)); });
        li.appendChild(sub);
      }
      return li;
    }
    function addBox(s, host) {
      if (!stageShown(s)) return;
      var el = document.createElement("div");
      el.dataset.id = s.id;
      placeBox(el, s);
      fillBox(el, s);
      host.appendChild(el);
      if (s.media_kind === "group") {
        membersOf(s.id).forEach(function (c) { addBox(c, el); });
      }
      if (s.id === sel) {
        ["n", "s", "e", "w", "nw", "ne", "sw", "se"].forEach(function (h) {
          var hd = document.createElement("div");
          hd.className = "handle " + h;
          hd.dataset.handle = h;
          el.appendChild(hd);
        });
      }
    }
    var ordered = state.slots.filter(function (s) { return !s.parent_id; }).sort(function (a, b) { return b.z - a.z; });
    list.innerHTML = "";
    ordered.forEach(function (s) { list.appendChild(layerRow(s)); });
    boxes.innerHTML = "";
    ordered.forEach(function (s) { addBox(s, boxes); });
    var ae = document.activeElement;
    var typing = ae && inspector.contains(ae) && ae.id !== "f-kind" && ae.id !== "f-file" &&
      (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && ae.type !== "file"));
    if (!(typing && inspector.dataset.slot === (sel || ""))) paintInspector();
  }

  function paintInspector() {
    var s = slotById(sel);
    if (!s) {
      document.getElementById("inspector-pane").classList.remove("in-group", "member");
      inspector.innerHTML = '<p class="muted">Select a slot</p>';
      inspector.dataset.slot = "";
      inspectorActions.hidden = true;
      inspectorActions.innerHTML = "";
      return;
    }
    var kind = s.media_kind || "text";
    var child = !!s.parent_id;
    var parent = child ? slotById(s.parent_id) : null;
    var pane = document.getElementById("inspector-pane");
    pane.classList.toggle("in-group", child || kind === "group");
    pane.classList.toggle("member", child);
    var html = "";
    if (kind === "group") {
      html += '<div class="where">Group</div>';
    } else if (child) {
      html += '<button type="button" class="where member" id="f-parent">In group · ' + esc((parent && (parent.label || parent.id)) || s.parent_id) + "</button>";
    }
    html +=
      '<label>id <input id="f-id" value="' + esc(s.id) + '"></label>' +
      '<label>label <input id="f-label" value="' + esc(s.label || "") + '"></label>' +
      '<div class="geom">' +
      '<label>x <input id="f-x" type="number" value="' + s.x + '"></label>' +
      '<label>y <input id="f-y" type="number" value="' + s.y + '"></label>' +
      '<label>w <input id="f-w" type="number" value="' + s.w + '"></label>' +
      '<label>h <input id="f-h" type="number" value="' + s.h + '"></label>' +
      '<label class="span">z <input id="f-z" type="number" value="' + s.z + '"></label>' +
      "</div>";
    if (!child) {
      html += '<label>type <select id="f-kind"><option value="text">text</option><option value="image">image</option><option value="gif">gif</option><option value="video">video</option><option value="audio">audio</option><option value="group">group</option></select></label>';
    } else {
      html += '<label>type <select id="f-kind"><option value="text">text</option><option value="image">image</option><option value="gif">gif</option><option value="video">video</option><option value="audio">audio</option></select></label>';
    }
    if (kind === "text") {
      html += '<label>text_template <textarea id="f-text">' + esc(s.text_template || "") + "</textarea></label>";
      html += '<label>theme <select id="f-theme">';
      THEMES.forEach(function (th) {
        html += '<option value="' + th.id + '"' + ((s.theme || "plain") === th.id ? " selected" : "") + ">" + th.name + "</option>";
      });
      html += "</select></label>";
      var lk = s.look || {};
      html += '<div class="geom">' +
        '<label>size <input id="f-font-size" type="number" min="8" max="400" value="' + (lk.font_size || 24) + '"></label>' +
        '<label>weight <select id="f-font-weight"><option value="400">400</option><option value="600">600</option><option value="700">700</option></select></label>' +
        '<label>fill <input id="f-fill" type="text" value="' + esc(lk.fill || "#ffffff") + '"></label>' +
        '<label>stroke <input id="f-stroke" type="text" value="' + esc(lk.stroke || "#111111") + '"></label>' +
        '<label>stroke_w <input id="f-stroke-w" type="number" min="0" max="20" value="' + (lk.stroke_w != null ? lk.stroke_w : 3) + '"></label>' +
        '<label>align <select id="f-align"><option value="left">left</option><option value="center">center</option><option value="right">right</option></select></label>' +
        '<label class="span">fit <select id="f-fit"><option value="shrink">shrink</option><option value="wrap">wrap</option><option value="ellipsis">ellipsis</option></select></label>' +
        "</div>";
    }
    if (!child) {
      html += '<label>motion <select id="f-motion"><option value="fade">fade</option><option value="slide">slide</option><option value="scale">scale</option></select></label>';
    }
    if (kind === "image" || kind === "gif" || kind === "video" || kind === "audio") {
      html += '<label>file <input id="f-file" type="file"></label>';
      html += '<label>existing <select id="f-media"></select></label>';
    }
    if (kind === "video" || kind === "audio") {
      html += '<label>playback <select id="f-play"><option>once</option><option>loop</option></select></label>';
      html += '<label>volume <input id="f-vol" type="number" min="0" max="100" value="' + s.volume + '"></label>';
    }
    if (!child) {
      html += '<label>duration_ms <span class="dur-row"><input id="f-dur" type="number" min="0" placeholder="blank = sticky" value="' + (s.duration_ms == null ? "" : s.duration_ms) + '"><button type="button" id="f-reset">Reset</button></span></label>';
      html += '<p class="muted">Blank duration stays on until Stop. Default for new slots is 5000.</p>';
    }
    if (kind === "group") {
      html += '<p class="muted">Members</p><ul id="f-members">';
      state.slots.filter(function (c) { return c.parent_id === s.id; }).forEach(function (c) {
        html += "<li>" + esc(c.label || c.id) + " (" + esc(c.media_kind) + ")</li>";
      });
      html += '</ul><label>add member <select id="f-add-kind"><option value="text">text</option><option value="image">image</option><option value="gif">gif</option><option value="video">video</option><option value="audio">audio</option></select></label>';
      html += '<p><button type="button" id="f-add-member">' + icon("plus") + " Add member</button></p>";
    }
    inspector.innerHTML = html;
    inspector.dataset.slot = s.id;
    var actions = '<div class="row">' +
      '<button type="button" id="f-save">' + icon("device-floppy") + " Save</button>" +
      '<button type="button" id="f-test">' + icon("player-play") + " Test</button>" +
      '<button type="button" id="f-stop">' + icon("x") + " Stop</button></div>" +
      '<div class="row">';
    if (!child) {
      actions += '<button type="button" id="f-copy" title="Copy trigger URL">' + icon("link") + " Copy URL</button>";
      actions += '<button type="button" id="f-dup">' + icon("copy") + " Duplicate</button>";
    }
    actions += '<button type="button" id="f-del">' + icon("trash") + " Trash</button></div>";
    inspectorActions.innerHTML = actions;
    inspectorActions.hidden = false;
    document.getElementById("f-kind").value = kind;
    var play = document.getElementById("f-play");
    if (play) play.value = s.playback || "once";
    var lk = s.look || {};
    var fw = document.getElementById("f-font-weight");
    if (fw) fw.value = String(lk.font_weight || 600);
    var al = document.getElementById("f-align");
    if (al) al.value = lk.align || "center";
    var fi = document.getElementById("f-fit");
    if (fi) fi.value = lk.fit || "shrink";
    var mo = document.getElementById("f-motion");
    if (mo) mo.value = lk.motion || "fade";
    var mediaSel = document.getElementById("f-media");
    if (mediaSel) {
      fetch("/api/media").then(function (r) { return r.json(); }).then(function (m) {
        var selEl = document.getElementById("f-media");
        if (!selEl) return;
        selEl.innerHTML = '<option value="">(pick)</option>';
        (m.files || []).forEach(function (f) {
          if (f.kind && f.kind !== kind) return;
          var o = document.createElement("option");
          o.value = f.path;
          o.dataset.kind = f.kind || "";
          o.textContent = f.path;
          if (f.path === s.media_path) o.selected = true;
          selEl.appendChild(o);
        });
      });
    }
  }

  function val(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    return el.value;
  }

  function lookFromForm(s) {
    var prev = s.look || {};
    return {
      font_size: +val("f-font-size", prev.font_size || 24),
      font_weight: +val("f-font-weight", prev.font_weight || 600),
      fill: val("f-fill", prev.fill || "#ffffff"),
      stroke: val("f-stroke", prev.stroke || "#111111"),
      stroke_w: +val("f-stroke-w", prev.stroke_w != null ? prev.stroke_w : 3),
      align: val("f-align", prev.align || "center"),
      fit: val("f-fit", prev.fit || "shrink"),
      motion: val("f-motion", prev.motion || "fade"),
    };
  }

  function readForm(s) {
    var durEl = document.getElementById("f-dur");
    var nid = document.getElementById("f-id").value.trim();
    if (nid !== s.id) {
      if (!confirm("Changing id creates a new slot; the old URL will 404. Continue?")) return null;
    }
    var kind = val("f-kind", s.media_kind);
    var body = {
      id: nid,
      label: document.getElementById("f-label").value,
      x: +document.getElementById("f-x").value,
      y: +document.getElementById("f-y").value,
      w: +document.getElementById("f-w").value,
      h: +document.getElementById("f-h").value,
      z: +document.getElementById("f-z").value,
      media_kind: kind,
      media_path: val("f-media", s.media_path || "") || s.media_path || "",
      text_template: val("f-text", s.text_template || ""),
      playback: val("f-play", s.playback || "once"),
      duration_ms: durEl ? (durEl.value === "" ? null : +durEl.value) : s.duration_ms,
      volume: document.getElementById("f-vol") ? +document.getElementById("f-vol").value : s.volume,
      theme: val("f-theme", s.theme || "plain"),
      parent_id: s.parent_id || "",
      enabled: s.enabled,
      look: lookFromForm(s),
    };
    if (kind !== "text") body.theme = "plain";
    if (kind !== "text") body.text_template = kind === "group" ? "" : body.text_template;
    if (kind === "text" || kind === "group") body.media_path = "";
    if (kind === "group") body.text_template = "";
    return body;
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

  function buttonFrom(e) {
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].tagName === "BUTTON") return path[i];
    }
    return e.target && e.target.closest ? e.target.closest("button") : null;
  }

  document.getElementById("inspector-pane").addEventListener("click", function (e) {
    var s = slotById(sel);
    if (!s) return;
    var btn = buttonFrom(e);
    var id = btn ? btn.id : e.target.id;
    if (id === "f-parent") {
      sel = s.parent_id;
      render();
      return;
    }
    if (id === "f-save") {
      var body = readForm(s);
      if (!body) return;
      persist(s, body).catch(function () {});
    }
    if (id === "f-test") {
      var fired = readForm(s);
      if (!fired) return;
      persist(s, fired).then(function () {
        return fetch(popupURL(fireId(fired), "user=Ada"), { method: "POST" });
      }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        var fid = fireId(fired);
        var fs = slotById(fid);
        if (fs) {
          fs.visible = true;
          paintSlotTree(fs);
        }
        var sticky = (fired.duration_ms == null || fired.duration_ms <= 0) && fired.media_kind !== "video" && fired.media_kind !== "audio" && fired.media_kind !== "group";
        setStatus(sticky ? "Fired (sticky — Stop to end)" : "Fired " + fid);
      }).catch(function (err) {
        if (!err || !err.save) setStatus("Fire failed");
      });
    }
    if (id === "f-stop") {
      fetch(origin() + "/api/popup/" + encodeURIComponent(fireId(s)) + "/stop" + tokenQuery(), { method: "POST" }).then(function (r) {
        if (r.ok) {
          var hid = slotById(fireId(s));
          if (hid) {
            hid.visible = false;
            paintSlotTree(hid);
          }
          setStatus("Stopped " + fireId(s));
        } else errMsg(r).then(setStatus);
      }).catch(function () { setStatus("Stop failed"); });
    }
    if (id === "f-copy") {
      copyText(popupURL(fireId(s))).then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
    }
    if (id === "f-dup") {
      fetch("/api/slots/" + encodeURIComponent(s.id) + "/duplicate", { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        return r.json().then(function (sl) {
          sel = sl.id;
          setStatus("Duplicated " + sl.id);
          return load();
        });
      }).catch(function () { setStatus("Duplicate failed"); });
    }
    if (id === "f-add-member") {
      var kind = (document.getElementById("f-add-kind") || {}).value || "text";
      var n = 1;
      while (slotById(s.id + "-" + n)) n++;
      var cid = s.id + "-" + n;
      fetch("/api/slots/" + cid, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cid, label: kind, x: 16, y: 16, w: 160, h: 80, z: n,
          media_kind: kind, media_path: "", text_template: kind === "text" ? "New slot" : "",
          playback: "once", duration_ms: null, volume: 100, enabled: true,
          parent_id: s.id, theme: "plain",
        }),
      }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        sel = cid;
        return load();
      });
    }
    if (id === "f-reset") {
      resetDuration(s);
      return;
    }
    if (id === "f-del") {
      fetch("/api/slots/" + encodeURIComponent(s.id), { method: "DELETE" }).then(function () { sel = null; return load(); });
    }
  });
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== "s") return;
    if (!settingsOverlay.hidden) return;
    var s = slotById(sel);
    if (!s) return;
    e.preventDefault();
    var body = readForm(s);
    if (body) persist(s, body).catch(function () {});
  });
  inspector.addEventListener("input", function (e) {
    var id = e.target.id;
    if (id === "f-x" || id === "f-y" || id === "f-w" || id === "f-h" || id === "f-z" || id === "f-label" || id === "f-text" || id === "f-theme" ||
        id === "f-font-size" || id === "f-font-weight" || id === "f-fill" || id === "f-stroke" || id === "f-stroke-w" || id === "f-align" || id === "f-fit") {
      applyInspectorPreview();
    }
  });
  inspector.addEventListener("change", function (e) {
    if (e.target.id === "f-file" && e.target.files[0]) {
      var fd = new FormData();
      fd.append("file", e.target.files[0]);
      fetch("/api/media", { method: "POST", body: fd }).then(function (r) { return r.json(); }).then(function (m) {
        var s = slotById(sel);
        if (!s || !m.path) return;
        return assignMedia(s, m.path, m.kind);
      });
      return;
    }
    if (e.target.id === "f-media" && e.target.value) {
      var s = slotById(sel);
      if (!s) return;
      var opt = e.target.selectedOptions && e.target.selectedOptions[0];
      var kind = (opt && opt.dataset.kind) || s.media_kind;
      assignMedia(s, e.target.value, kind);
      return;
    }
    if (e.target.id === "f-id") return;
    var persistIds = { "f-x": 1, "f-y": 1, "f-w": 1, "f-h": 1, "f-z": 1, "f-label": 1, "f-kind": 1, "f-text": 1, "f-play": 1, "f-dur": 1, "f-vol": 1, "f-theme": 1,
      "f-font-size": 1, "f-font-weight": 1, "f-fill": 1, "f-stroke": 1, "f-stroke-w": 1, "f-align": 1, "f-fit": 1, "f-motion": 1 };
    if (!persistIds[e.target.id]) return;
    var s = slotById(sel);
    if (!s) return;
    var body = readForm(s);
    if (!body) return;
    if (e.target.id === "f-kind") {
      if (body.media_kind === "text" && !body.text_template) body.text_template = "New slot";
      if (body.media_kind !== "text") body.text_template = "";
      if (body.media_kind === "text" || body.media_kind === "group") body.media_path = "";
      var needsFile = body.media_kind === "image" || body.media_kind === "gif" || body.media_kind === "video" || body.media_kind === "audio";
      if (needsFile && !body.media_path) {
        s.media_kind = body.media_kind;
        paintInspector();
        return;
      }
    }
    applyInspectorPreview();
    persist(s, body).catch(function () {});
  });

  list.addEventListener("click", function (e) {
    var eye = e.target.closest("[data-eye]");
    if (!eye) return;
    e.preventDefault();
    e.stopPropagation();
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
        media_kind: "text", media_path: "", text_template: "New slot", playback: "once",
        duration_ms: DEFAULT_DURATION_MS, volume: 100, enabled: true, parent_id: "", theme: "plain",
      }),
    }).then(function () { sel = id; return load(); });
  });

  document.getElementById("copy-overlay").addEventListener("click", function () {
    copyText(origin() + "/overlay/").then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
  });
  document.getElementById("stop-all").addEventListener("click", function () {
    fetch(origin() + "/api/popup/stop_all" + tokenQuery(), { method: "POST" }).then(function (r) {
      if (r.ok) {
        state.slots.forEach(function (sl) { sl.visible = false; });
        state.slots.filter(function (sl) { return !sl.parent_id; }).forEach(paintSlotTree);
        setStatus("Stopped all");
      } else errMsg(r).then(setStatus);
    }).catch(function () { setStatus("Stop all failed"); });
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
    if (s.parent_id) {
      var par = slotById(s.parent_id);
      if (par) {
        gx = [0, par.w, par.w / 2];
        gy = [0, par.h, par.h / 2];
      }
    }
    if (hdl === "move") {
      x = snapEdge(x, w, gx);
      y = snapEdge(y, h, gy);
    } else {
      if (hdl.indexOf("w") >= 0) x = snapVal(x, gx);
      if (hdl.indexOf("e") >= 0) w = Math.max(32, snapVal(x + w, gx) - x);
      if (hdl.indexOf("n") >= 0) y = snapVal(y, gy);
      if (hdl.indexOf("s") >= 0) h = Math.max(32, snapVal(y + h, gy) - y);
    }
    var lim = boundsFor(s);
    w = Math.max(32, Math.min(w, lim.w));
    h = Math.max(32, Math.min(h, lim.h));
    x = Math.max(0, Math.min(lim.w - w, x));
    y = Math.max(0, Math.min(lim.h - h, y));
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
      placeBox(el, s);
      if (s.media_kind === "group") {
        membersOf(s.id).forEach(function (c) {
          var cel = el.querySelector(':scope > .box[data-id="' + c.id + '"]');
          if (cel) placeBox(cel, c);
        });
      }
    }
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
          if (!cur) return;
          var on = !!sl.visible;
          if (!!cur.visible === on) return;
          cur.visible = on;
          paintSlotTree(cur);
        });
        setObsPill(s.obs && s.obs.connected);
        fillScenes(s.obs);
      }).catch(function () {
        downBanner.hidden = false;
      });
    }, 2000);
  });
})();
