(function () {
  var token = "";
  var statusTimer = 0;
  var downBanner = document.getElementById("down-banner");
  var list = document.getElementById("list");
  var empty = document.getElementById("empty");

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

  function render(slots) {
    var rows = topSlots(slots);
    empty.hidden = rows.length > 0;
    list.innerHTML = "";
    rows.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "row" + (isOn(s) ? "" : " off") + (s.visible ? " on" : "");
      row.dataset.id = s.id;
      row.innerHTML =
        '<span class="live" title="' + (s.visible ? "live" : "off") + '"></span>' +
        '<span class="who"><span class="label"></span><span class="id"></span></span>' +
        '<span class="acts">' +
        '<button type="button" data-act="fire">Fire</button>' +
        '<button type="button" data-act="hide">Hide</button>' +
        '<button type="button" data-act="copy-fire">Copy fire URL</button>' +
        '<button type="button" data-act="copy-hide">Copy hide URL</button>' +
        "</span>";
      row.querySelector(".label").textContent = s.label || s.id;
      row.querySelector(".id").textContent = s.id;
      list.appendChild(row);
    });
  }

  function load() {
    return fetch("/api/state").then(function (r) {
      if (!r.ok) throw new Error("down");
      downBanner.hidden = true;
      return r.json();
    }).then(function (s) {
      render(s.slots);
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
    if (act === "fire") {
      fetch(popupURL(id, "user=Ada"), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Fired " + id);
        return load();
      }).catch(function () { setStatus("Fire failed"); });
      return;
    }
    if (act === "hide") {
      fetch(origin() + "/api/popup/" + encodeURIComponent(id) + "/hide" + tokenQuery(), { method: "POST" }).then(function (r) {
        if (!r.ok) return errMsg(r).then(setStatus);
        setStatus("Hidden " + id);
        return load();
      }).catch(function () { setStatus("Hide failed"); });
      return;
    }
    if (act === "copy-fire") {
      copyText(popupURL(id)).then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
      return;
    }
    if (act === "copy-hide") {
      copyText(hideURL(id)).then(function () { setStatus("Copied"); }).catch(function () { setStatus("Copy failed"); });
    }
  });

  document.getElementById("btn-hide-all").addEventListener("click", function () {
    fetch(origin() + "/api/popup/hide_all" + tokenQuery(), { method: "POST" }).then(function (r) {
      if (!r.ok) return errMsg(r).then(setStatus);
      setStatus("Hidden all");
      return load();
    }).catch(function () { setStatus("Hide all failed"); });
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
