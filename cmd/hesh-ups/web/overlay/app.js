(function () {
  var canvas = document.getElementById("canvas");
  var slots = {};
  var nodes = {};
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var ws;

  function connect() {
    ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type === "pong") return;
      if (msg.type === "config") {
        slots = {};
        (msg.slots || []).forEach(function (s) {
          slots[s.id] = s;
        });
        if (msg.canvas) {
          document.body.style.width = msg.canvas.w + "px";
          document.body.style.height = msg.canvas.h + "px";
        }
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
      if (msg.type === "hide") {
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
      el.src = (msg.media_url || "") + (msg.seq != null ? "?s=" + msg.seq : "");
      el.volume = vol;
      if (msg.playback === "loop") el.loop = true;
      if (msg.playback !== "loop" && ended) {
        el.addEventListener("ended", ended);
      }
      host.appendChild(el);
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
    }
  }

  function show(msg) {
    var id = msg.id || msg.slot;
    var n = nodeFor(id);
    stopThemes(n);
    n.innerHTML = "";
    n.removeAttribute("data-theme");
    var kind = msg.media_kind;
    n.setAttribute("data-kind", kind || "");
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
    n.classList.remove("is-on");
    stopThemes(n);
    n.querySelectorAll("video, audio").forEach(function (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    });
    n.innerHTML = "";
  }

  setInterval(function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
  }, 15000);

  connect();
})();
