(() => {
  "use strict";
  const root = new URL("./", document.currentScript.src);
  const pendingKey = "ray.navigation:" + root.href;
  function pageAddress(value) {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/\/$/, "") || "/";
    return url.href;
  }
  let entry = history.state?.rayNavigation;
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
    sessionStorage.removeItem(pendingKey);
    if (!entry && pending?.url && pageAddress(pending.url) === pageAddress(location.href) && Date.now() - pending.time < 30000) {
      entry = { index: pending.parent.index + 1, parent: pending.parent };
    }
  } catch {}
  entry ||= { index: 0 };
  const commit = () => {
    try { history.replaceState({ ...history.state, rayNavigation: entry }, ""); } catch {}
  };
  commit();
  history.scrollRestoration = "manual";

  function save() {
    entry = {
      ...entry,
      scroll: { x: scrollX, y: scrollY },
      details: Array.from(document.querySelectorAll("details"), el => el.open),
      fields: Array.from(document.querySelectorAll("input[id], textarea[id]"))
        .filter(el => !["password", "file"].includes(el.type))
        .map(el => ({ id: el.id, value: el.value })),
      videoTime: document.querySelector("video")?.currentTime
    };
    commit();
  }
  function restore() {
    entry = history.state?.rayNavigation || entry;
    if (!entry.scroll) return;
    document.querySelectorAll("details").forEach((el, i) => {
      if (entry.details?.[i] !== undefined) el.open = entry.details[i];
    });
    entry.fields?.forEach(field => {
      const el = document.getElementById(field.id);
      if (el) el.value = field.value;
    });
    const video = document.querySelector("video");
    if (video && Number.isFinite(entry.videoTime)) {
      const seek = () => { video.currentTime = entry.videoTime; };
      if (video.readyState) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
    }
    scrollTo({ left: entry.scroll.x, top: entry.scroll.y, behavior: "instant" });
  }
  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey || link.download ||
        (link.target && link.target !== "_self")) return;
    if (link.hasAttribute("data-return") && entry.parent) {
      event.preventDefault();
      save();
      history.go(entry.parent.index - entry.index);
      return;
    }
    const url = new URL(link.href);
    if (!url.href.startsWith(root.href)) return;
    save();
    if (url.pathname === location.pathname && url.search === location.search) return;
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({
        url: url.href, time: Date.now(), parent: { index: entry.index, url: location.href }
      }));
    } catch {}
  });
  // A chapter anchor creates a history entry too. Keep its distance to the parent.
  addEventListener("popstate", () => {
    if (history.state?.rayNavigation) {
      entry = history.state.rayNavigation;
      requestAnimationFrame(restore);
    }
  });
  addEventListener("hashchange", () => {
    if (history.state?.rayNavigation) {
      entry = history.state.rayNavigation;
    } else {
      entry = { index: entry.index + 1, parent: entry.parent };
      commit();
    }
  });
  addEventListener("pagehide", save);
  addEventListener("pageshow", () => requestAnimationFrame(restore));
})();
