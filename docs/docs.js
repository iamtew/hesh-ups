(function () {
  var pages = [
    { id: "overview", title: "Overview", group: "Start" },
    { id: "running", title: "Running", group: "Start" },
    { id: "composer", title: "Composer", group: "Surfaces" },
    { id: "overlay", title: "Overlay", group: "Surfaces" },
    { id: "http", title: "HTTP", group: "Build" },
    { id: "obs", title: "OBS", group: "Build" },
  ];

  var nav = document.getElementById("nav");
  var article = document.getElementById("doc");
  var lastGroup = "";

  pages.forEach(function (page) {
    if (page.group && page.group !== lastGroup) {
      lastGroup = page.group;
      var heading = document.createElement("p");
      heading.className = "nav-group";
      heading.textContent = page.group;
      nav.appendChild(heading);
    }
    var link = document.createElement("a");
    link.href = "#" + page.id;
    link.textContent = page.title;
    link.dataset.id = page.id;
    nav.appendChild(link);
  });

  function known(id) {
    return pages.some(function (page) {
      return page.id === id;
    });
  }

  function currentId() {
    var id = (location.hash || "#overview").replace(/^#/, "");
    return known(id) ? id : "overview";
  }

  function rewrite(root) {
    root.querySelectorAll("a[href]").forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var match = href.match(/^(?:\.\/)?([a-z0-9-]+)\.md(#[a-z0-9-]*)?$/);
      if (match && known(match[1])) link.setAttribute("href", "#" + match[1]);
    });
    root.querySelectorAll("img[src]").forEach(function (img) {
      var src = img.getAttribute("src") || "";
      if (src.indexOf("../img/") === 0) img.setAttribute("src", src.slice(3));
    });
  }

  function show() {
    var id = currentId();
    if ((location.hash || "#overview").replace(/^#/, "") !== id) {
      history.replaceState(null, "", "#" + id);
    }
    nav.querySelectorAll("a").forEach(function (link) {
      var on = link.dataset.id === id;
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    var page = pages.filter(function (item) {
      return item.id === id;
    })[0];
    document.title = page.title + " — hesh-ups";
    article.innerHTML = '<p class="muted">Loading…</p>';
    fetch("md/" + id + ".md")
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then(function (md) {
        article.innerHTML = marked.parse(md);
        rewrite(article);
      })
      .catch(function () {
        article.innerHTML = "<p>Could not load this page. Open the .md files on GitHub if you used file://.</p>";
      });
  }

  window.addEventListener("hashchange", show);
  show();
})();
