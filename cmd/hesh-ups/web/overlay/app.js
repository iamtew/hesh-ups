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

  // Canvas stays in canvas pixels. zoom fits the viewport (OBS at canvas size is 1:1).
  // A CSS transform on an ancestor blanks <video> in WebView2 and OBS.
  function fitCanvas() {
    if (canvasW <= 0 || canvasH <= 0) return;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    var s = Math.min(window.innerWidth / canvasW, window.innerHeight / canvasH);
    if (!isFinite(s) || s <= 0) s = 1;
    var ox = Math.round((window.innerWidth - canvasW * s) / 2);
    var oy = Math.round((window.innerHeight - canvasH * s) / 2);
    canvas.style.transform = "";
    canvas.style.left = ox + "px";
    canvas.style.top = oy + "px";
    canvas.style.zoom = s === 1 ? "" : String(s);
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
        return;
      }
      if (msg.type === "snapshot") {
        var keep = {};
        (msg.visible || []).forEach(function (v) {
          keep[v.id || v.slot] = true;
          show(v);
        });
        Object.keys(nodes).forEach(function (id) {
          if (!keep[id]) hide(id);
        });
        return;
      }
      if (msg.type === "show") {
        show(msg);
        return;
      }
      if (msg.type === "stop") {
        hide(msg.slot);
        return;
      }
      if (msg.type === "clear") {
        Object.keys(nodes).forEach(hide);
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
      function queue() {
        if (pendingSound.indexOf(el) < 0) pendingSound.push(el);
      }
      // Muted play first so the picture starts. Unmute is a second play();
      // if that is blocked, go back to muted so the frames keep going.
      function loud() {
        if (el._heshLoud) return;
        el._heshLoud = true;
        el.muted = false;
        el.volume = vol;
        var p = el.play();
        if (p && p.then) {
          p.catch(function () {
            el.muted = true;
            el.volume = 0;
            var again = el.play();
            if (again && again.catch) again.catch(function () {});
            queue();
          });
        }
      }
      function kick() {
        if (el._heshLoud) return;
        el.muted = true;
        el.volume = 0;
        var p = el.play();
        if (p && p.then) {
          p.then(loud).catch(queue);
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

  // Opacity or transform on an ancestor blanks video/audio in WebView2/CEF.
  function flatMedia(msg) {
    var kind = msg.media_kind;
    if (kind === "video" || kind === "audio") return true;
    if (kind !== "group") return false;
    var members = msg.members || [];
    for (var i = 0; i < members.length; i++) {
      var k = members[i].media_kind;
      if (k === "video" || k === "audio") return true;
    }
    return false;
  }

  function show(msg) {
    var id = msg.id || msg.slot;
    hideGen[id] = (hideGen[id] || 0) + 1;
    var n = nodeFor(id);
    stopThemes(n);
    n.innerHTML = "";
    n.removeAttribute("data-theme");
    var kind = msg.media_kind;
    n.setAttribute("data-kind", kind || "");
    var mot = (msg.look && msg.look.motion) || (slots[id] && slots[id].look && slots[id].look.motion) || "fade";
    n.setAttribute("data-motion", mot);
    if (flatMedia(msg)) {
      n.setAttribute("data-flat", "1");
      n.classList.add("is-on");
      void n.offsetWidth;
    } else {
      n.removeAttribute("data-flat");
    }
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
        if ((m.media_kind === "video" || m.media_kind === "audio") && m.playback !== "loop") {
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
      if ((kind === "video" || kind === "audio") && msg.playback !== "loop") {
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
