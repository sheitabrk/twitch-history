'use strict';

function formatDuration(ms) {
  if (!ms) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function loadStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['th_history'], (result) => {
      const history = result.th_history || [];
      const totalMs = history.reduce((sum, e) => sum + (e.duration || 0), 0);

      document.getElementById('stat-count').textContent = history.length;
      document.getElementById('stat-time').textContent = formatDuration(totalMs);
      resolve();
    });
  });
}

document.getElementById('open-twitch-btn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['*://www.twitch.tv/*', '*://twitch.tv/*'] });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_HISTORY' });
    } catch {
      // Content script may not be loaded yet — opening the tab is enough.
    }
  } else {
    await chrome.tabs.create({ url: 'https://www.twitch.tv' });
  }
  window.close();
});

loadStats();
