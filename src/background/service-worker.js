'use strict';

// Manifest V3 service worker. Persists a final history entry when a Twitch tab
// unloads (the content script can't await chrome.storage during 'beforeunload')
// and opens the history view when the toolbar icon is clicked.

const STORAGE_KEY_HISTORY  = 'th_history';
const STORAGE_KEY_SETTINGS = 'th_settings';
const SESSION_MERGE_WINDOW_MS = 30 * 60 * 1000;

const DEFAULT_SETTINGS = {
  minDurationMs: 0,
  maxEntries: 500,
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

async function getSettings() {
  const result = await storageGet([STORAGE_KEY_SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY_SETTINGS] || {}) };
}

async function getHistory() {
  const result = await storageGet([STORAGE_KEY_HISTORY]);
  return result[STORAGE_KEY_HISTORY] || [];
}

function makeSessionId(channelName, timestamp) {
  return `${channelName}_${timestamp}`;
}

// Mirrors the merge logic in storage-manager.js; kept standalone because the
// service worker doesn't share the content-script module scope.
async function saveEntry(entry) {
  const settings = await getSettings();
  const history = await getHistory();
  const now = Date.now();

  if ((entry.duration || 0) < settings.minDurationMs) return;

  const mergeWindowStart = now - SESSION_MERGE_WINDOW_MS;
  const existingIndex = history.findIndex(
    (e) =>
      e.channelName === entry.channelName &&
      e.lastViewedAt >= mergeWindowStart
  );

  if (existingIndex !== -1) {
    const existing = history[existingIndex];
    const updated = {
      ...existing,
      duration: (existing.duration || 0) + (entry.duration || 0),
      lastViewedAt: now,
      streamTitle: entry.streamTitle || existing.streamTitle,
      game: entry.game || existing.game,
      thumbnailUrl: entry.thumbnailUrl || existing.thumbnailUrl,
      channelDisplayName: entry.channelDisplayName || existing.channelDisplayName,
      viewCount: (existing.viewCount || 1) + 1,
    };
    history.splice(existingIndex, 1);
    history.unshift(updated);
  } else {
    history.unshift({
      id: makeSessionId(entry.channelName, entry.sessionStart || now),
      channelName: entry.channelName || '',
      channelDisplayName: entry.channelDisplayName || entry.channelName || '',
      streamTitle: entry.streamTitle || '',
      game: entry.game || '',
      url: entry.url || `https://www.twitch.tv/${entry.channelName}`,
      thumbnailUrl: entry.thumbnailUrl || '',
      sessionStart: entry.sessionStart || now,
      lastViewedAt: now,
      duration: entry.duration || 0,
      viewCount: 1,
    });
  }

  if (history.length > settings.maxEntries) {
    history.splice(settings.maxEntries);
  }

  await storageSet({ [STORAGE_KEY_HISTORY]: history });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_HISTORY_ENTRY') {
    saveEntry(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[TwitchHistory SW] Save error:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // keep the message channel open for the async response
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_HISTORY' });
  } catch {
    // No content script on this tab (not a Twitch page) — open Twitch instead.
    await chrome.tabs.create({ url: 'https://www.twitch.tv' });
  }
});
