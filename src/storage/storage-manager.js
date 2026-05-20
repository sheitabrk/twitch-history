/*
 * Read/write layer over chrome.storage.local.
 *
 * Storage shape:
 *   th_history  — HistoryEntry[], newest first
 *   th_settings — { minDurationMs, maxEntries }
 *
 * Sessions are merged rather than duplicated: revisiting the same channel
 * within SESSION_MERGE_WINDOW_MS updates the existing entry (accumulating watch
 * time) instead of creating a new one.
 */
window.TwitchStorageManager = (() => {
  'use strict';

  const STORAGE_KEY_HISTORY = 'th_history';
  const STORAGE_KEY_SETTINGS = 'th_settings';
  const SESSION_MERGE_WINDOW_MS = 30 * 60 * 1000;

  const DEFAULT_SETTINGS = {
    minDurationMs: 0,
    maxEntries: 500,
  };

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function storageGet(keys) {
    if (!isContextValid()) return Promise.reject(new Error('Extension context invalidated'));
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSet(items) {
    if (!isContextValid()) return Promise.reject(new Error('Extension context invalidated'));
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function getHistory() {
    const result = await storageGet([STORAGE_KEY_HISTORY]);
    return result[STORAGE_KEY_HISTORY] || [];
  }

  async function getSettings() {
    const result = await storageGet([STORAGE_KEY_SETTINGS]);
    const stored = result[STORAGE_KEY_SETTINGS] || {};

    // Early versions defaulted minDurationMs to 120000. Reset untouched installs
    // (no _version flag) to the current default of 0.
    if (!stored._version && stored.minDurationMs === 120000) {
      stored.minDurationMs = 0;
      storageSet({ [STORAGE_KEY_SETTINGS]: { ...DEFAULT_SETTINGS, ...stored, _version: 2 } })
        .catch(() => {});
    }

    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async function saveSettings(settings) {
    const current = await getSettings();
    await storageSet({ [STORAGE_KEY_SETTINGS]: { ...current, ...settings } });
  }

  async function addOrUpdateEntry(entry) {
    const settings = await getSettings();
    const history = await getHistory();

    const now = Date.now();
    const mergeWindowStart = now - SESSION_MERGE_WINDOW_MS;

    // A match is the same channel, same session type, and recent enough to
    // merge. Different VODs from one channel stay separate, hence the vodUrl check.
    const existingIndex = history.findIndex(
      (e) =>
        e.channelName === entry.channelName &&
        e.lastViewedAt >= mergeWindowStart &&
        (e.sessionType || 'live') === (entry.sessionType || 'live') &&
        (entry.sessionType !== 'vod' || e.vodUrl === entry.vodUrl)
    );

    if (existingIndex !== -1) {
      const existing = history[existingIndex];
      const updated = {
        ...existing,
        duration:           (existing.duration || 0) + (entry.duration || 0),
        lastViewedAt:       now,
        streamTitle:        entry.streamTitle        || existing.streamTitle,
        game:               entry.game               || existing.game,
        thumbnailUrl:       entry.thumbnailUrl       || existing.thumbnailUrl,
        avatarUrl:          entry.avatarUrl          || existing.avatarUrl || '',
        channelDisplayName: entry.channelDisplayName || existing.channelDisplayName,
        vodUrl:             entry.vodUrl             || existing.vodUrl || '',
        channelUrl:         entry.channelUrl         || existing.channelUrl || `https://www.twitch.tv/${existing.channelName}`,
        url:                entry.url                || existing.url,
        sessionType:        existing.sessionType || entry.sessionType || 'live',
        // A merge means the same visit, so viewCount is left untouched.
        viewCount:          existing.viewCount || 1,
      };
      history.splice(existingIndex, 1);
      history.unshift(updated);
    } else {
      const newEntry = {
        id:                 window.TwitchHistoryHelpers.makeSessionId(entry.channelName, entry.sessionStart || now),
        channelName:        entry.channelName        || '',
        channelDisplayName: entry.channelDisplayName || entry.channelName || '',
        streamTitle:        entry.streamTitle        || '',
        game:               entry.game               || '',
        vodUrl:             entry.vodUrl             || '',
        channelUrl:         entry.channelUrl         || `https://www.twitch.tv/${entry.channelName}`,
        url:                entry.url                || `https://www.twitch.tv/${entry.channelName}`,
        thumbnailUrl:       entry.thumbnailUrl       || '',
        avatarUrl:          entry.avatarUrl          || '',
        sessionStart:       entry.sessionStart       || now,
        lastViewedAt:       now,
        duration:           entry.duration           || 0,
        sessionType:        entry.sessionType        || 'live',
        viewCount:          1,
      };
      history.unshift(newEntry);
    }

    if (history.length > settings.maxEntries) {
      history.splice(settings.maxEntries);
    }

    await storageSet({ [STORAGE_KEY_HISTORY]: history });
  }

  async function removeEntry(id) {
    const history = await getHistory();
    await storageSet({ [STORAGE_KEY_HISTORY]: history.filter((e) => e.id !== id) });
  }

  async function clearHistory() {
    await storageSet({ [STORAGE_KEY_HISTORY]: [] });
  }

  async function exportHistory() {
    const history = await getHistory();
    const settings = await getSettings();
    return JSON.stringify({ version: 1, exportedAt: Date.now(), settings, history }, null, 2);
  }

  // Imports a file produced by exportHistory() and merges it into the current
  // history, skipping entries that are malformed or already present.
  async function importHistory(jsonString) {
    let payload;
    try {
      payload = JSON.parse(jsonString);
    } catch {
      throw new Error('Invalid JSON');
    }

    if (!payload || !Array.isArray(payload.history)) {
      throw new Error('Invalid format: missing history array');
    }

    const existing = await getHistory();
    const existingIds = new Set(existing.map((e) => e.id));
    let imported = 0;
    let skipped = 0;

    for (const entry of payload.history) {
      if (!entry.id || !entry.channelName || existingIds.has(entry.id)) {
        skipped++;
        continue;
      }
      existing.push(entry);
      existingIds.add(entry.id);
      imported++;
    }

    existing.sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));

    const settings = await getSettings();
    if (existing.length > settings.maxEntries) {
      existing.splice(settings.maxEntries);
    }

    await storageSet({ [STORAGE_KEY_HISTORY]: existing });
    return { imported, skipped };
  }

  return {
    getHistory,
    getSettings,
    saveSettings,
    addOrUpdateEntry,
    removeEntry,
    clearHistory,
    exportHistory,
    importHistory,
  };
})();
