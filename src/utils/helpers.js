window.TwitchHistoryHelpers = (() => {
  'use strict';

  function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return 'Just now';
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff < 2 * day) return 'Yesterday';
    if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatDuration(durationMs) {
    if (!durationMs || durationMs < 0) return '';
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return '< 1m';
  }

  function truncate(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 1) + '…';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function getChannelFromPath(pathname) {
    // Twitch's own routes — these are not channel pages.
    const IGNORED_PATHS = new Set([
      '/', '/directory', '/following', '/friends', '/subscriptions',
      '/inventory', '/wallet', '/notifications', '/settings', '/login',
      '/signup', '/downloads', '/prime', '/bits', '/drops', '/payments',
      '/history', '/messages', '/inbox',
    ]);

    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const first = segments[0].toLowerCase();
    if (
      IGNORED_PATHS.has('/' + first) ||
      first === 'directory' ||
      first === 'p' ||        // legal pages
      first === 'help' ||
      first === 'jobs' ||
      first === 'about' ||
      first === 'user' ||
      first === 'popout'
    ) {
      return null;
    }

    // Only "/channel" is a live page — "/channel/videos", "/channel/clips" are not.
    if (segments.length === 1) return segments[0].toLowerCase();
    return null;
  }

  function getVodIdFromPath(pathname) {
    const m = pathname.match(/^\/videos\/(\d+)\/?$/);
    return m ? m[1] : null;
  }

  function makeSessionId(channelName, timestamp) {
    return `${channelName}_${timestamp}`;
  }

  function showToast(message, type = 'info') {
    document.getElementById('th-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'th-toast';
    toast.className = `th-toast th-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('th-toast--visible'));
    });

    setTimeout(() => {
      toast.classList.remove('th-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  return {
    formatDate,
    formatDuration,
    truncate,
    escapeHtml,
    debounce,
    getChannelFromPath,
    getVodIdFromPath,
    makeSessionId,
    showToast,
  };
})();
