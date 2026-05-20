/*
 * Injects the "History" button into Twitch's left sidebar. Twitch re-renders the
 * sidebar on navigation and obfuscates its class names, so the button is placed
 * through a list of fallback selectors and re-injected whenever it disappears.
 */
window.TwitchSidebar = (() => {
  'use strict';

  const BUTTON_ID = 'th-sidebar-btn';

  // Ordered by preference. Class names are obfuscated, so data attributes first.
  const SIDEBAR_SELECTORS = [
    '[data-a-target="side-nav-bar"]',
    'nav[aria-label]',
    '[class*="side-nav"]',
    '.side-nav',
    'aside nav',
    'nav',
  ];

  let observer = null;
  let injectDebounceTimer = null;

  function findSidebar() {
    for (const sel of SIDEBAR_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // A real sidebar is tall and pinned to the left...
      if (rect.height > 200 && rect.left < 200) return el;
      // ...but accept it before layout if it has no size yet.
      if (rect.height === 0) return el;
    }
    return null;
  }

  function findInjectionPoint(sidebar) {
    const sectionSelectors = [
      '[data-a-target="side-nav-header-twitch"]',
      '[class*="side-nav__section"]',
      '[class*="SideNav__Section"]',
      'ul',
      'div[class*="nav"]',
    ];

    for (const sel of sectionSelectors) {
      const section = sidebar.querySelector(sel);
      if (section && section.parentElement) {
        return { parent: section.parentElement, anchor: section };
      }
    }

    return { parent: sidebar, anchor: null };
  }

  function createButton() {
    const li = document.createElement('div');
    li.id = BUTTON_ID;
    li.className = 'th-sidebar-item';
    li.setAttribute('role', 'listitem');
    li.setAttribute('title', 'Watch History');
    li.innerHTML = `
      <button class="th-sidebar-btn" aria-label="Watch History" type="button">
        <div class="th-sidebar-btn__icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z" fill="currentColor"/>
            <path d="M12 7v5l3 3-1.5 1.5L10 13V7h2z" fill="currentColor"/>
          </svg>
        </div>
        <span class="th-sidebar-btn__label">History</span>
      </button>
    `;

    li.querySelector('button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.TwitchHistoryView.toggle();
    });

    return li;
  }

  function inject() {
    if (document.getElementById(BUTTON_ID)) return;

    const sidebar = findSidebar();
    if (!sidebar) return;

    const { parent, anchor } = findInjectionPoint(sidebar);
    const btn = createButton();

    if (anchor) parent.insertBefore(btn, anchor);
    else parent.prepend(btn);
  }

  // Debounced so a burst of React re-renders triggers a single injection.
  function scheduleInject() {
    clearTimeout(injectDebounceTimer);
    injectDebounceTimer = setTimeout(inject, 500);
  }

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      const buttonGone = !document.getElementById(BUTTON_ID);
      const hasNewNodes = mutations.some((m) => m.addedNodes.length > 0);
      if (buttonGone && hasNewNodes) scheduleInject();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    inject();
    startObserver();
    // Twitch may swap the whole sidebar on navigation; re-inject afterwards.
    window.TwitchRouter.onRouteChange(() => setTimeout(scheduleInject, 800));
  }

  return { init };
})();
