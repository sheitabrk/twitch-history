// Content-script entry point. Loaded last; boots the tracker and the sidebar.

(() => {
  'use strict';

  if (window.__TWITCH_HISTORY_INITIALIZED__) return;
  window.__TWITCH_HISTORY_INITIALIZED__ = true;

  function init() {
    try {
      window.TwitchTracker.init();
      window.TwitchSidebar.init();
    } catch (err) {
      console.error('[TwitchHistory] Initialization error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'OPEN_HISTORY') {
        window.TwitchHistoryView.show();
        sendResponse({ ok: true });
      }
    });
  } catch {
    // The extension context can already be invalid after a reload.
  }
})();
