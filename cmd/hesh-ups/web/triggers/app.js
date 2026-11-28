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

  function hideURL(id) {
    return origin() + "/api/popup/" + encodeURIComponent(id) + "/hide" + tokenQuery();
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

  function toggleHtml(live) {
    return live ? icon("eye-off") + " Hide" : icon("eye") + " Show";
  }

  function setToggle(row, live) {
    var btn = row.querySelector('[data-act="toggle"]');
    if (!btn) return;
    btn.innerHTML = toggleHtml(live);
    btn.setAttribute("aria-pressed", live ? "true" : "false");
  }

  function anyLive(rows) {
    return rows.some(function (s) { return !!s.visible; });
  }

  function setAllBtn(live) {
    var btn = document.getElementById("btn-stop-all");
    btn.innerHTML = live ? icon("x") + " Stop all" : icon("eye") + " Show all";
    btn.setAttribute("aria-pressed", live ? "true" : "false");
    btn.dataset.mode = live ? "stop" : "show";
  }

  function paintLive(rows) {
    rows.forEach(function (s) {
      var row = list.querySelector('[data-id="' + s.id + '"]');
      if (!row) return;
      row.classList.toggle("on", !!s.visible);
      var live = row.querySelector(".live");
      if (live) live.setAttribute("title", s.visible ? "live" : "idle");
      setToggle(row, !!s.visible);
    });
    setAllBtn(anyLive(rows));
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
        '<button type="button" data-act="toggle" aria-pressed="' + (s.visible ? "true" : "false") + '">' + toggleHtml(!!s.visible) + "</button>" +
        '<button type="button" class="icon-btn" data-act="copy-fire" title="Copy fire URL" aria-label="Copy fire URL">' + icon("link") + "</button>" +
        '<button type="button" class="icon-btn" data-act="copy-hide" title="Copy hide URL" aria-label="Copy hide URL">' + icon("copy") + "</button>" +
        "</span>";
      row.querySelector(".label").textContent = s.label || s.id;
      row.querySelector(".id").textContent = s.id;
      if (!on) row.title = "Disabled — fire is 404 until the composer eye is on";
      list.appendChild(row);
    });
    setAllBtn(anyLive(rows));
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

  list.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var row = btn.closest(".row");
    if (!row) return;
    var id = row.dataset.id;
    var act = btn.getAttribute("data-act");
    if (act === "fire" || (act === "toggle" && !row.classList.contains("on"))) {
      fetch(popupURL(id, "user=Ada"), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Fired " + id);
        return load();
      }).catch(function () { setStatus("Fire failed"); });
      return;
    }
    if (act === "toggle") {
      fetch(origin() + "/api/popup/" + encodeURIComponent(id) + "/hide" + tokenQuery(), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Hidden " + id);
        return load();
      }).catch(function () { setStatus("Hide failed"); });
      return;
    }
    if (act === "copy-fire") {
      copyText(popupURL(id)).then(function () { setStatus("Copied fire URL"); }).catch(function () { setStatus("Copy failed"); });
      return;
    }
    if (act === "copy-hide") {
      copyText(hideURL(id)).then(function () { setStatus("Copied hide URL"); }).catch(function () { setStatus("Copy failed"); });
    }
  });

  document.getElementById("btn-stop-all").addEventListener("click", function () {
    var btn = document.getElementById("btn-stop-all");
    if (btn.dataset.mode === "show") {
      var ids = [];
      list.querySelectorAll(".row:not(.off)").forEach(function (row) {
        ids.push(row.dataset.id);
      });
      Promise.all(ids.map(function (id) {
        return fetch(popupURL(id, "user=Ada"), { method: "POST" });
      })).then(function () {
        setStatus(ids.length ? "Fired all" : "Nothing to show");
        return load();
      }).catch(function () { setStatus("Show all failed"); });
      return;
    }
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
