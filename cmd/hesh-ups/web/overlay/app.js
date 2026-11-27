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

  function place(id) {
    var n = nodes[id];
    var meta = slots[id];
    if (!n || !meta) return;
    var on = n.classList.contains("is-on");
    n.className = "slot" + (meta.css_class ? " " + meta.css_class : "");
    if (on) n.classList.add("is-on");
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
      n.className = "slot";
      canvas.appendChild(n);
      nodes[id] = n;
    }
    place(id);
    return n;
  }

  function show(msg) {
    var id = msg.id || msg.slot;
    var n = nodeFor(id);
    n.innerHTML = "";
    var vol = (msg.volume != null ? msg.volume : 100) / 100;
    if (msg.media_kind === "image" || msg.media_kind === "gif") {
      var img = document.createElement("img");
      img.src = msg.media_url + "?s=" + msg.seq;
      n.appendChild(img);
    } else if (msg.media_kind === "video") {
      var v = document.createElement("video");
      v.autoplay = true;
      v.src = msg.media_url + "?s=" + msg.seq;
      v.volume = vol;
      if (msg.playback === "loop") v.loop = true;
      v.addEventListener("ended", function () {
        if (msg.playback === "once" && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ended", slot: id, seq: msg.seq }));
        }
      });
      n.appendChild(v);
    } else if (msg.media_kind === "audio") {
      var a = document.createElement("audio");
      a.autoplay = true;
      a.src = msg.media_url + "?s=" + msg.seq;
      a.volume = vol;
      if (msg.playback === "loop") a.loop = true;
      a.addEventListener("ended", function () {
        if (msg.playback === "once" && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ended", slot: id, seq: msg.seq }));
        }
      });
      n.appendChild(a);
    }
    if (msg.text) {
      var t = document.createElement("div");
      t.className = "text";
      t.innerHTML = msg.text;
      n.appendChild(t);
    }
    n.classList.add("is-on");
  }

  function hide(id) {
    var n = nodes[id];
    if (!n) return;
    n.classList.remove("is-on");
    n.querySelectorAll("video, audio").forEach(function (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    });
  }

  setInterval(function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
  }, 15000);

  connect();
})();
