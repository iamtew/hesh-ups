(function () {
  var canvas = document.getElementById("canvas");
  var canvasW = 0;
  var canvasH = 0;
  var slots = {};
  var nodes = {};
  var hideGen = {};
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var ws;
  var audioUnlocked = /OBS/i.test(navigator.userAgent);
  var pendingSound = [];
  // Tray preview only. OBS loads /overlay/ with no query and stays empty until fire.
  var preview = /[?&]preview=1(?:&|$)/.test(location.search);

  function unlockAudio() {
    audioUnlocked = true;
    pendingSound.forEach(function (el) {
      if (!el.isConnected) return;
      el.muted = false;
      el.volume = el._heshVol != null ? el._heshVol : 1;
      var p = el.play();
      if (p && p.catch) p.catch(function () {});
    });
    pendingSound = [];
  }
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  // Canvas stays in canvas pixels. Scale fits the viewport (OBS at canvas size is 1:1).
  function fitCanvas() {
    if (canvasW <= 0 || canvasH <= 0) return;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    var s = Math.min(window.innerWidth / canvasW, window.innerHeight / canvasH);
    if (!isFinite(s) || s <= 0) s = 1;
    var ox = Math.round((window.innerWidth - canvasW * s) / 2);
    var oy = Math.round((window.innerHeight - canvasH * s) / 2);
    canvas.style.transform = "translate(" + ox + "px," + oy + "px) scale(" + s + ")";
  }
  window.addEventListener("resize", fitCanvas);

  function connect() {
    ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === "pong") return;
      if (msg.type === "config") {
        slots = {};
        (msg.slots || []).forEach(function (s) {
          slots[s.id] = s;
        });
        if (msg.canvas && msg.canvas.w > 0 && msg.canvas.h > 0) {
          canvasW = msg.canvas.w;
          canvasH = msg.canvas.h;
        }
        fitCanvas();
        Object.keys(nodes).forEach(place);
        previewRefresh();
        return;
      }
      if (msg.type === "snapshot") {
        var keep = {};
        (msg.visible || []).forEach(function (v) {
          keep[v.id || v.slot] = true;
          show(v);
        });
        Object.keys(nodes).forEach(function (id) {
          if (keep[id]) return;
          if (nodes[id]) nodes[id].removeAttribute("data-program");
          hide(id);
        });
        previewRefresh();
        return;
      }
      if (msg.type === "show") {
        show(msg);
        return;
      }
      if (msg.type === "stop") {
        if (nodes[msg.slot]) nodes[msg.slot].removeAttribute("data-program");
        hide(msg.slot);
        previewRefresh();
        return;
      }
      if (msg.type === "clear") {
        Object.keys(nodes).forEach(function (id) {
          if (nodes[id]) nodes[id].removeAttribute("data-program");
          hide(id);
        });
        previewRefresh();
      }
    };
    ws.onclose = function () {
      setTimeout(connect, 1000);
    };
  }

  function effects() {
    return (window.SeshThemes && window.SeshThemes.effects) || {};
  }

  function stopThemes(root) {
    var fx = effects();
    root.querySelectorAll(".theme-panel").forEach(function (p) {
      Object.keys(fx).forEach(function (id) {
        if (fx[id] && fx[id].stop) fx[id].stop(p);
      });
    });
  }

  function startTheme(popup) {
    var id = popup.getAttribute("data-theme");
    var panel = popup.querySelector(".theme-panel");
    var fx = effects();
    if (panel && id && fx[id] && fx[id].start) fx[id].start(panel);
  }

  function sendEnded(slot, seq) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ended", slot: slot, seq: seq }));
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function slotOn(s) {
    return !!s && s.enabled !== false && s.enabled !== 0 && s.enabled !== "0";
  }

  function sampleText(tmpl) {
    var filled = String(tmpl || "").replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function (_, name) {
      return name === "user" ? "Ada" : "";
    });
    return esc(filled);
  }

  function mediaURL(s) {
    if (!s || s.media_kind === "text" || s.media_kind === "group" || !s.media_path) return "";
    return "/media/" + s.media_path;
  }

  function sampleMember(c) {
    return {
      id: c.id, media_kind: c.media_kind, media_url: mediaURL(c), playback: c.playback,
      volume: 0, text: sampleText(c.text_template), theme: c.theme || "plain", look: c.look,
      x: c.x, y: c.y, w: c.w, h: c.h, z: c.z, _sample: true,
    };
  }

  function sampleMsg(s) {
    var msg = {
      id: s.id, media_kind: s.media_kind, media_url: mediaURL(s), playback: s.playback,
      volume: 0, text: sampleText(s.text_template), theme: s.theme || "plain", look: s.look,
      _sample: true, seq: 0,
    };
    if (s.media_kind === "group") {
      msg.members = Object.keys(slots).map(function (id) { return slots[id]; }).filter(function (c) {
        return c.parent_id === s.id && slotOn(c);
      }).map(sampleMember);
      msg.media_url = "";
      msg.text = "";
    }
    return msg;
  }

  function previewRefresh() {
    if (!preview) return;
    Object.keys(slots).forEach(function (id) {
      var s = slots[id];
      if (!s || s.parent_id) return;
      var n = nodes[id];
      if (n && n.getAttribute("data-program") === "1" && n.classList.contains("is-on")) return;
      if (!slotOn(s)) {
        if (n) hide(id);
        return;
      }
      if (s.media_kind === "group") {
        var any = Object.keys(slots).some(function (cid) {
          return slots[cid].parent_id === id && slotOn(slots[cid]);
        });
        if (!any) {
          if (n) hide(id);
          return;
        }
      }
      show(sampleMsg(s));
    });
  }

  function place(id) {
    var n = nodes[id];
    var meta = slots[id];
    if (!n || !meta) return;
    var on = n.classList.contains("is-on");
    n.className = "slot popup" + (on ? " is-on" : "");
    n.setAttribute("data-kind", meta.media_kind || "");
    var mot = (meta.look && meta.look.motion) || "fade";
    n.setAttribute("data-motion", mot);
    n.style.left = (meta.x || 0) + "px";
    n.style.top = (meta.y || 0) + "px";
    n.style.width = (meta.w || 100) + "px";
    n.style.height = (meta.h || 100) + "px";
    n.style.zIndex = String(meta.z || 0);
  }

  function nodeFor(id) {
    var n = nodes[id];
    if (!n) {
      n = document.createElement("div");
      n.className = "slot popup";
      canvas.appendChild(n);
      nodes[id] = n;
    }
    place(id);
    return n;
  }

  function fillKind(host, msg, ended) {
    var kind = msg.media_kind;
    var vol = (msg.volume != null ? msg.volume : 100) / 100;
    if (kind === "image" || kind === "gif") {
      var img = document.createElement("img");
      img.src = (msg.media_url || "") + (msg.seq != null ? "?s=" + msg.seq : "");
      host.appendChild(img);
      return;
    }
    if (kind === "video" || kind === "audio") {
      var el = document.createElement(kind);
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.muted = true;
      el._heshVol = vol;
      el.volume = 0;
      el.src = (msg.media_url || "") + (msg.seq != null ? "?s=" + msg.seq : "");
      if (msg.playback === "loop") el.loop = true;
      if (msg.playback !== "loop" && ended) {
        el.addEventListener("ended", ended);
      }
      function kick() {
        var p = el.play();
        function loud() {
          if (msg._sample) {
            el.muted = true;
            el.volume = 0;
            return;
          }
          el.muted = false;
          el.volume = vol;
          if (!audioUnlocked) pendingSound.push(el);
        }
        if (p && p.then) {
          p.then(loud).catch(function () {
            if (!msg._sample) pendingSound.push(el);
          });
        } else {
          loud();
        }
      }
      el.addEventListener("canplay", kick, { once: true });
      host.appendChild(el);
      kick();
      return;
    }
    if (kind === "text") {
      var theme = msg.theme || "plain";
      host.setAttribute("data-theme", theme);
      var wrap = document.createElement("div");
      wrap.className = "banner-content" + (theme === "plain" ? "" : " theme-panel");
      var t = document.createElement("div");
      t.className = "banner-text";
      t.innerHTML = msg.text || "";
      wrap.appendChild(t);
      host.appendChild(wrap);
      startTheme(host);
      if (window.applyLook) window.applyLook(host, msg.look);
    }
  }

  function show(msg) {
    var id = msg.id || msg.slot;
    hideGen[id] = (hideGen[id] || 0) + 1;
    var n = nodeFor(id);
    if (msg._sample) n.removeAttribute("data-program");
    else n.setAttribute("data-program", "1");
    stopThemes(n);
    n.innerHTML = "";
    n.removeAttribute("data-theme");
    var kind = msg.media_kind;
    n.setAttribute("data-kind", kind || "");
    var mot = (msg.look && msg.look.motion) || (slots[id] && slots[id].look && slots[id].look.motion) || "fade";
    n.setAttribute("data-motion", mot);
    if (kind === "group") {
      var once = 0;
      (msg.members || []).forEach(function (m) {
        if ((m.media_kind === "video" || m.media_kind === "audio") && m.playback !== "loop") once++;
      });
      var left = { n: once };
      (msg.members || []).forEach(function (m) {
        var child = document.createElement("div");
        child.className = "popup member";
        child.setAttribute("data-kind", m.media_kind || "");
        child.style.left = (m.x || 0) + "px";
        child.style.top = (m.y || 0) + "px";
        child.style.width = (m.w || 32) + "px";
        child.style.height = (m.h || 32) + "px";
        child.style.zIndex = String(m.z || 0);
        var ended = null;
        if (!msg._sample && (m.media_kind === "video" || m.media_kind === "audio") && m.playback !== "loop") {
          ended = function () {
            left.n--;
            if (left.n <= 0) sendEnded(id, msg.seq);
          };
        }
        fillKind(child, m, ended);
        n.appendChild(child);
      });
    } else {
      var ended = null;
      if (!msg._sample && (kind === "video" || kind === "audio") && msg.playback !== "loop") {
        ended = function () { sendEnded(id, msg.seq); };
      }
      fillKind(n, msg, ended);
    }
    n.classList.add("is-on");
  }

  function hide(id) {
    var n = nodes[id];
    if (!n) return;
    hideGen[id] = (hideGen[id] || 0) + 1;
    var g = hideGen[id];
    n.classList.remove("is-on");
    n.querySelectorAll("video, audio").forEach(function (el) {
      el.pause();
    });
    setTimeout(function () {
      if (hideGen[id] !== g || n.classList.contains("is-on")) return;
      stopThemes(n);
      n.querySelectorAll("video, audio").forEach(function (el) {
        el.pause();
        el.removeAttribute("src");
      });
      n.innerHTML = "";
    }, 220);
  }

  setInterval(function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
  }, 15000);

  connect();
})();
