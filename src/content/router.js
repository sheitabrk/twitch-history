/*
 * Detects Twitch SPA navigation. Twitch's React router captures history.pushState
 * before our content script runs, so patching pushState misses navigations.
 * Instead we poll location.pathname and observe the <title> element, which
 * Twitch rewrites on every navigation.
 */
window.TwitchRouter = (() => {
  'use strict';

  const listeners = [];
  let currentPath = location.pathname;

  function checkPath() {
    const newPath = location.pathname;
    if (newPath === currentPath) return;
    const oldPath = currentPath;
    currentPath = newPath;
    notifyListeners(newPath, oldPath);
  }

  // Reliable baseline.
  setInterval(checkPath, 500);

  // The <title> changes on every navigation, which beats the poll on latency.
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(checkPath).observe(titleEl, { childList: true });
  } else {
    // <title> may not exist yet — wait for it to appear, then watch it.
    new MutationObserver((_, obs) => {
      const t = document.querySelector('title');
      if (t) {
        obs.disconnect();
        new MutationObserver(checkPath).observe(t, { childList: true });
      }
    }).observe(document.head || document.documentElement, { childList: true, subtree: true });
  }

  // Browser back/forward.
  window.addEventListener('popstate', checkPath);

  function notifyListeners(newPath, oldPath) {
    for (const fn of listeners) {
      try {
        fn(newPath, oldPath);
      } catch (err) {
        console.warn('[TH:Router] Listener error:', err);
      }
    }
  }

  function onRouteChange(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function getCurrentPath() {
    return location.pathname;
  }

  return { onRouteChange, getCurrentPath };
})();
