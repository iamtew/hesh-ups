(function () {
  var token = "";
  var statusTimer = 0;
  var lastKey = "";
  var downBanner = document.getElementById("down-banner");
  var list = document.getElementById("list");
  var empty = document.getElementById("empty");

  function origin() {
    return location.origin;
  }

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="/composer/icons.svg#tabler-' + name + '"></use></svg>';
  }

  function kindIcon(s) {
    if (s.media_kind === "group") return "stack-2";
    if (s.media_kind === "image" || s.media_kind === "gif") return "photo";
    if (s.media_kind === "video") return "movie";
    if (s.media_kind === "audio") return "volume";
    return "letter-t";
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

  function stopURL(id) {
    return origin() + "/api/popup/" + encodeURIComponent(id) + "/stop" + tokenQuery();
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
      return (e && (e.message || e.error)) || r.statusText;
    }).catch(function () {
      return r.statusText;
    });
  }

  function topSlots(slots) {
    return (slots || []).filter(function (s) {
      return !s.parent_id;
    }).sort(function (a, b) {
      if (a.z !== b.z) return b.z - a.z;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  function isOn(s) {
    return s.enabled !== false && s.enabled !== 0 && s.enabled !== "0";
  }

  function layoutKey(rows) {
    return rows.map(function (s) {
      return [s.id, s.label || "", s.media_kind || "", isOn(s) ? "1" : "0"].join("\t");
    }).join("\n");
  }

  function paintLive(rows) {
    rows.forEach(function (s) {
      var row = list.querySelector('[data-id="' + s.id + '"]');
      if (!row) return;
      row.classList.toggle("on", !!s.visible);
      var live = row.querySelector(".live");
      if (live) live.setAttribute("title", s.visible ? "live" : "idle");
    });
  }

  function render(rows) {
    empty.hidden = rows.length > 0;
    list.innerHTML = "";
    rows.forEach(function (s) {
      var row = document.createElement("div");
      var on = isOn(s);
      row.className = "row" + (on ? "" : " off") + (s.visible ? " on" : "");
      row.dataset.id = s.id;
      row.innerHTML =
        '<span class="kind" title="' + (s.media_kind || "text") + '">' + icon(kindIcon(s)) + "</span>" +
        '<span class="live" title="' + (s.visible ? "live" : "idle") + '">LIVE</span>' +
        '<span class="who"><span class="label"></span><span class="id"></span></span>' +
        '<span class="acts">' +
        '<button type="button" class="btn-fire" data-act="fire">' + icon("player-play") + " Fire</button>" +
        '<button type="button" data-act="stop">' + icon("x") + " Stop</button>" +
        '<button type="button" class="icon-btn" data-act="copy-fire" title="Copy fire URL" aria-label="Copy fire URL">' + icon("link") + "</button>" +
        '<button type="button" class="icon-btn" data-act="copy-stop" title="Copy stop URL" aria-label="Copy stop URL">' + icon("copy") + "</button>" +
        "</span>";
      row.querySelector(".label").textContent = s.label || s.id;
      row.querySelector(".id").textContent = s.id;
      if (!on) row.title = "Disabled — fire is 404 until the composer eye is on";
      list.appendChild(row);
    });
  }

  function load() {
    return fetch("/api/state").then(function (r) {
      if (!r.ok) throw new Error("down");
      downBanner.hidden = true;
      return r.json();
    }).then(function (s) {
      var rows = topSlots(s.slots);
      var key = layoutKey(rows);
      if (key !== lastKey) {
        lastKey = key;
        render(rows);
      } else {
        paintLive(rows);
      }
    }).catch(function () {
      downBanner.hidden = false;
    });
  }

  function buttonFrom(e) {
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].tagName === "BUTTON") return path[i];
    }
    return e.target && e.target.closest ? e.target.closest("button") : null;
  }

  list.addEventListener("click", function (e) {
    var btn = buttonFrom(e);
    if (!btn || !list.contains(btn)) return;
    var row = btn.closest(".row");
    if (!row) return;
    var id = row.dataset.id;
    var act = btn.getAttribute("data-act");
    if (act === "fire") {
      fetch(popupURL(id, "user=Ada"), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Fired " + id);
        return load();
      }).catch(function () { setStatus("Fire failed"); });
      return;
    }
    if (act === "stop") {
      fetch(stopURL(id), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Stopped " + id);
        return load();
      }).catch(function () { setStatus("Stop failed"); });
      return;
    }
    if (act === "copy-fire") {
      copyText(popupURL(id)).then(function () { setStatus("Copied fire URL"); }).catch(function () { setStatus("Copy failed"); });
      return;
    }
    if (act === "copy-stop") {
      copyText(stopURL(id)).then(function () { setStatus("Copied stop URL"); }).catch(function () { setStatus("Copy failed"); });
    }
  });

  document.getElementById("btn-fire-all").addEventListener("click", function () {
    var ids = [];
    list.querySelectorAll(".row:not(.off)").forEach(function (row) {
      ids.push(row.dataset.id);
    });
    Promise.all(ids.map(function (id) {
      return fetch(popupURL(id, "user=Ada"), { method: "POST" });
    })).then(function () {
      setStatus(ids.length ? "Fired all" : "Nothing to fire");
      return load();
    }).catch(function () { setStatus("Fire all failed"); });
  });

  document.getElementById("btn-stop-all").addEventListener("click", function () {
    fetch(origin() + "/api/popup/stop_all" + tokenQuery(), { method: "POST" }).then(function (r) {
      if (!r.ok) return errMsg(r).then(setStatus);
      setStatus("Stopped all");
      return load();
    }).catch(function () { setStatus("Stop all failed"); });
  });

  fetch("/api/settings").then(function (r) { return r.json(); }).then(function (kv) {
    token = kv.token || "";
    return load();
  }).then(function () {
    setInterval(load, 2000);
  }).catch(function () {
    downBanner.hidden = false;
  });
})();
