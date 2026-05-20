/*
 * The full-page Watch History overlay. The DOM is built once and then shown or
 * hidden with CSS classes, so reopening it never re-renders the shell.
 */
window.TwitchHistoryView = (() => {
  'use strict';

  const { formatDate, formatDuration, escapeHtml, truncate, showToast, debounce } =
    window.TwitchHistoryHelpers;
  const storage = window.TwitchStorageManager;

  const OVERLAY_ID = 'th-history-overlay';
  const ITEMS_PER_PAGE = 50;

  let overlayEl = null;
  let isVisible = false;
  let currentPage = 0;
  let allEntries = [];
  let filteredEntries = [];
  let searchQuery = '';

  function buildOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.setAttribute('role', 'main');
    overlayEl.setAttribute('aria-label', 'Watch History');
    overlayEl.innerHTML = `
      <div class="th-overlay__inner">
        <header class="th-header">
          <div class="th-header__title-row">
            <span class="th-header__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z" fill="currentColor"/>
                <path d="M12 7v5l3 3-1.5 1.5L10 13V7h2z" fill="currentColor"/>
              </svg>
            </span>
            <h1 class="th-header__title">Watch History</h1>
          </div>
          <div class="th-header__actions">
            <button class="th-btn th-btn--ghost th-btn--icon" id="th-settings-btn" title="Settings" aria-label="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
            <button class="th-btn th-btn--ghost th-btn--icon" id="th-export-btn" title="Export history" aria-label="Export history">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="th-btn th-btn--ghost th-btn--icon" id="th-import-btn" title="Import history" aria-label="Import history">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <polyline points="7 10 12 5 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="5" x2="12" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <input type="file" id="th-import-file" accept=".json" style="display:none" aria-label="Import file"/>
            <button class="th-btn th-btn--danger-ghost" id="th-clear-btn">
              Clear all
            </button>
            <button class="th-btn th-btn--ghost th-btn--icon" id="th-close-btn" aria-label="Close history">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </header>

        <div class="th-toolbar">
          <div class="th-search-wrap">
            <svg class="th-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <input
              type="text"
              id="th-search-input"
              class="th-search-input"
              placeholder="Search channels or titles…"
              autocomplete="off"
              spellcheck="false"
              aria-label="Search history"
            />
            <button class="th-search-clear" id="th-search-clear" aria-label="Clear search" style="display:none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <span class="th-count" id="th-count"></span>
        </div>

        <div class="th-content" id="th-content">
          <div class="th-list" id="th-list"></div>
          <div class="th-pagination" id="th-pagination" style="display:none">
            <button class="th-btn th-btn--ghost" id="th-prev-btn">← Previous</button>
            <span class="th-pagination__info" id="th-page-info"></span>
            <button class="th-btn th-btn--ghost" id="th-next-btn">Next →</button>
          </div>
        </div>
      </div>

      <div class="th-settings-panel" id="th-settings-panel" aria-hidden="true">
        <div class="th-settings-panel__inner">
          <h2 class="th-settings-panel__title">Settings</h2>
          <div class="th-settings-row">
            <label class="th-settings-label" for="th-min-duration">
              Minimum watch time before recording
            </label>
            <select id="th-min-duration" class="th-select">
              <option value="0">No minimum (record everything)</option>
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
              <option value="120000">2 minutes</option>
              <option value="300000">5 minutes</option>
              <option value="600000">10 minutes</option>
            </select>
          </div>
          <div class="th-settings-row">
            <label class="th-settings-label" for="th-max-entries">
              Maximum history entries
            </label>
            <select id="th-max-entries" class="th-select">
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500" selected>500</option>
              <option value="1000">1000</option>
            </select>
          </div>
          <div class="th-settings-footer">
            <button class="th-btn th-btn--primary" id="th-save-settings-btn">Save settings</button>
            <button class="th-btn th-btn--ghost" id="th-close-settings-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);
    attachEventListeners();
  }

  function attachEventListeners() {
    const $ = (id) => document.getElementById(id);

    $('th-close-btn').addEventListener('click', hide);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isVisible) hide();
    });

    const searchInput = $('th-search-input');
    const searchClear = $('th-search-clear');

    searchInput.addEventListener('input', debounce(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      searchClear.style.display = searchQuery ? 'flex' : 'none';
      currentPage = 0;
      applyFilter();
      renderList();
    }, 200));

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.style.display = 'none';
      currentPage = 0;
      applyFilter();
      renderList();
      searchInput.focus();
    });

    $('th-clear-btn').addEventListener('click', async () => {
      if (!confirm('Clear your entire watch history? This cannot be undone.')) return;
      await storage.clearHistory();
      allEntries = [];
      filteredEntries = [];
      currentPage = 0;
      renderList();
      showToast('History cleared', 'success');
    });

    $('th-export-btn').addEventListener('click', async () => {
      try {
        const json = await storage.exportHistory();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitch-history-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('History exported', 'success');
      } catch (err) {
        showToast('Export failed', 'error');
        console.error('[TwitchHistory] Export error:', err);
      }
    });

    $('th-import-btn').addEventListener('click', () => $('th-import-file').click());

    $('th-import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const { imported, skipped } = await storage.importHistory(text);
        await refreshData();
        showToast(`Imported ${imported} entries (${skipped} skipped)`, 'success');
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      }
      // Reset the input so the same file can be re-imported.
      e.target.value = '';
    });

    $('th-prev-btn').addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        renderList();
        $('th-content').scrollTop = 0;
      }
    });
    $('th-next-btn').addEventListener('click', () => {
      const totalPages = Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);
      if (currentPage < totalPages - 1) {
        currentPage++;
        renderList();
        $('th-content').scrollTop = 0;
      }
    });

    $('th-settings-btn').addEventListener('click', () => openSettings());
    $('th-close-settings-btn').addEventListener('click', () => closeSettings());
    $('th-save-settings-btn').addEventListener('click', async () => {
      const minDuration = parseInt($('th-min-duration').value, 10);
      const maxEntries = parseInt($('th-max-entries').value, 10);
      await storage.saveSettings({ minDurationMs: minDuration, maxEntries });
      closeSettings();
      showToast('Settings saved', 'success');
    });

    // The list element is reused across renders, so one delegated handler is enough.
    $('th-list').addEventListener('click', handleListClick);
  }

  async function openSettings() {
    const panel = document.getElementById('th-settings-panel');
    if (!panel) return;
    const settings = await storage.getSettings();

    const minSelect = document.getElementById('th-min-duration');
    const maxSelect = document.getElementById('th-max-entries');
    if (minSelect) minSelect.value = String(settings.minDurationMs);
    if (maxSelect) maxSelect.value = String(settings.maxEntries);

    panel.classList.add('th-settings-panel--visible');
    panel.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    const panel = document.getElementById('th-settings-panel');
    if (!panel) return;
    panel.classList.remove('th-settings-panel--visible');
    panel.setAttribute('aria-hidden', 'true');
  }

  async function refreshData() {
    allEntries = await storage.getHistory();
    applyFilter();
  }

  function applyFilter() {
    if (!searchQuery) {
      filteredEntries = allEntries.slice();
    } else {
      filteredEntries = allEntries.filter((e) => {
        const haystack = [e.channelName, e.channelDisplayName, e.streamTitle, e.game]
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchQuery);
      });
    }
    updateCount();
  }

  function updateCount() {
    const el = document.getElementById('th-count');
    if (!el) return;
    if (filteredEntries.length === 0) {
      el.textContent = '';
    } else if (searchQuery) {
      el.textContent = `${filteredEntries.length} result${filteredEntries.length !== 1 ? 's' : ''}`;
    } else {
      el.textContent = `${filteredEntries.length} session${filteredEntries.length !== 1 ? 's' : ''}`;
    }
  }

  function renderList() {
    const listEl = document.getElementById('th-list');
    const paginationEl = document.getElementById('th-pagination');
    const pageInfoEl = document.getElementById('th-page-info');
    const prevBtn = document.getElementById('th-prev-btn');
    const nextBtn = document.getElementById('th-next-btn');

    if (!listEl) return;

    if (filteredEntries.length === 0) {
      listEl.innerHTML = renderEmptyState();
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    const totalPages = Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);
    currentPage = Math.min(currentPage, totalPages - 1);

    const start = currentPage * ITEMS_PER_PAGE;
    const pageEntries = filteredEntries.slice(start, start + ITEMS_PER_PAGE);

    listEl.innerHTML = pageEntries.map(renderCard).join('');

    if (paginationEl) {
      if (totalPages > 1) {
        paginationEl.style.display = 'flex';
        if (pageInfoEl) pageInfoEl.textContent = `Page ${currentPage + 1} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage === 0;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages - 1;
      } else {
        paginationEl.style.display = 'none';
      }
    }
  }

  function renderCard(entry) {
    const fallbackLetter = escapeHtml((entry.channelDisplayName || entry.channelName || '?')[0].toUpperCase());
    const previewSrc = escapeHtml(entry.thumbnailUrl || '');
    const avatarSrc  = escapeHtml(entry.avatarUrl || '');

    // A missing or broken preview falls back to a coloured letter tile.
    const previewImg = previewSrc
      ? `<img class="th-card__preview" src="${previewSrc}" alt="" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const avatarFallback = `<div class="th-card__avatar-fallback" style="${previewSrc ? 'display:none' : ''}">${fallbackLetter}</div>`;
    const avatarBadge = avatarSrc
      ? `<img class="th-card__avatar-small" src="${avatarSrc}" alt="" loading="lazy"
             onerror="this.style.display='none'">`
      : '';

    const duration = formatDuration(entry.duration);
    const date = formatDate(entry.lastViewedAt);
    const fullDate = entry.lastViewedAt
      ? new Date(entry.lastViewedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    const title = escapeHtml(truncate(entry.streamTitle || '(no title scraped yet)', 80));
    const channel = escapeHtml(entry.channelDisplayName || entry.channelName);
    const game = escapeHtml(entry.game || '');
    const channelUrl = escapeHtml(entry.channelUrl || entry.url || `https://www.twitch.tv/${entry.channelName}`);
    const vodUrl = escapeHtml(entry.vodUrl || '');
    const viewCount = entry.viewCount && entry.viewCount > 1
      ? `<span class="th-card__badge">${entry.viewCount}×</span>`
      : '';

    const vodBtn = vodUrl
      ? `<button class="th-btn th-btn--primary th-btn--sm" data-action="open" data-url="${vodUrl}" title="Rewatch this broadcast (VOD)" aria-label="Rewatch VOD">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
           Rewatch
         </button>`
      : '';

    return `
      <div class="th-card" data-id="${escapeHtml(entry.id)}">
        <div class="th-card__thumb-wrap">
          ${previewImg}
          ${avatarFallback}
          ${avatarBadge}
        </div>
        <div class="th-card__body">
          <div class="th-card__top">
            <a class="th-card__channel" href="${channelUrl}" data-action="open" data-url="${channelUrl}" tabindex="0">
              ${channel}
            </a>
            ${viewCount}
          </div>
          <p class="th-card__title">${title}</p>
          <div class="th-card__meta">
            ${game ? `<span class="th-card__game">${game}</span>` : ''}
            ${duration ? `<span class="th-card__duration">${duration}</span>` : ''}
            <span class="th-card__date" title="${escapeHtml(fullDate)}">${date}</span>
            ${vodUrl ? `<span class="th-card__vod-badge">VOD</span>` : ''}
          </div>
        </div>
        <div class="th-card__actions">
          ${vodBtn}
          <button class="th-btn th-btn--ghost th-btn--sm" data-action="open" data-url="${channelUrl}" title="Go to channel" aria-label="Go to ${channel}'s channel">
            Channel
          </button>
          <button class="th-btn th-btn--ghost th-btn--sm th-btn--icon th-btn--danger" data-action="delete" data-id="${escapeHtml(entry.id)}" title="Remove from history" aria-label="Remove from history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    if (searchQuery) {
      return `
        <div class="th-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p class="th-empty__title">No results for "${escapeHtml(searchQuery)}"</p>
          <p class="th-empty__sub">Try a different channel name or stream title.</p>
        </div>
      `;
    }
    return `
      <div class="th-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="th-empty__title">No watch history yet</p>
        <p class="th-empty__sub">Visit a stream and it will appear here automatically.</p>
      </div>
    `;
  }

  function handleListClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (action === 'open') {
      const url = actionEl.dataset.url || actionEl.closest('[data-url]')?.dataset.url;
      if (url) {
        hide();
        // Navigate within Twitch's SPA instead of triggering a full page load.
        history.pushState(null, '', new URL(url).pathname);
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      }
    }

    if (action === 'delete') {
      const id = actionEl.dataset.id;
      if (id) deleteEntry(id);
    }
  }

  async function deleteEntry(id) {
    await storage.removeEntry(id);
    allEntries = allEntries.filter((e) => e.id !== id);
    applyFilter();
    renderList();
    showToast('Entry removed', 'info');
  }

  async function show() {
    buildOverlay();
    try {
      await refreshData();
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        showContextInvalidatedBanner();
        return;
      }
      throw err;
    }
    renderList();
    overlayEl.classList.add('th-overlay--visible');
    isVisible = true;
    document.body.classList.add('th-no-scroll');

    setTimeout(() => document.getElementById('th-search-input')?.focus(), 100);
  }

  // Shown when the extension was reloaded and the content-script context is dead.
  function showContextInvalidatedBanner() {
    buildOverlay();
    const listEl = document.getElementById('th-list');
    if (listEl) {
      listEl.innerHTML = `
        <div class="th-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
            <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p class="th-empty__title">Extension updated</p>
          <p class="th-empty__sub">Reload this page to continue using Twitch History.</p>
          <button class="th-btn th-btn--primary" onclick="location.reload()" style="margin-top:16px">Reload page</button>
        </div>
      `;
    }
    overlayEl.classList.add('th-overlay--visible');
    isVisible = true;
    document.body.classList.add('th-no-scroll');
  }

  function hide() {
    if (!overlayEl) return;
    overlayEl.classList.remove('th-overlay--visible');
    isVisible = false;
    document.body.classList.remove('th-no-scroll');
    closeSettings();
  }

  function toggle() {
    if (isVisible) hide();
    else show();
  }

  // Keep the list in sync if history changes (e.g. from another tab) while open.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.th_history && isVisible) {
        refreshData().then(() => renderList()).catch(() => {});
      }
    });
  } catch (e) {}

  return { show, hide, toggle };
})();
