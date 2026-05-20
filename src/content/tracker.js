/*
 * Tracks how long the user watches each channel. Live pages (/channel) and VOD
 * pages (/videos/{id}) are tracked as separate session types and never merged
 * into each other. Metadata comes from Twitch's GQL API, with DOM scraping as a
 * fallback while the API request is in flight.
 */
window.TwitchTracker = (() => {
  'use strict';

  const { getChannelFromPath, getVodIdFromPath } = window.TwitchHistoryHelpers;
  const storage = window.TwitchStorageManager;

  const META_RETRY_INTERVAL = 3000;
  const META_RETRY_MAX = 20;

  let activeSession = null;
  let metaRetryCount = 0;
  let gqlClientId = null;

  function scrapeMetadata() {
    // Avatar is deliberately not scraped here: the first profile image in the
    // DOM is often the viewer's own. It comes from GQL instead.
    const meta = { streamTitle: '', game: '', channelDisplayName: '' };

    // document.title is rewritten by Twitch on every navigation, so it's never stale.
    const docTitle = document.title || '';
    const isGenericTitle = /^twitch\s*$/i.test(docTitle.trim());
    if (!isGenericTitle && docTitle) {
      const cleaned = docTitle.replace(/\s*[-–]\s*Twitch\s*$/i, '').trim();
      const parts = cleaned.split(/\s+-\s+/);
      if (parts.length >= 2) {
        if (activeSession?.isVod) {
          // VOD title format: "Stream Title - channelName - Twitch"
          meta.streamTitle        = parts[0].trim();
          meta.channelDisplayName = parts[1].trim();
        } else {
          // Live title format: "channelName - Stream Title - Twitch"
          meta.channelDisplayName = parts[0].trim();
          meta.streamTitle        = parts.slice(1).join(' - ').trim();
        }
      } else if (parts.length === 1) {
        if (activeSession?.isVod) meta.streamTitle = parts[0].trim();
        else meta.channelDisplayName = parts[0].trim();
      }
    }

    for (const sel of [
      '[data-a-target="stream-title"]',
      'p[data-a-target="stream-title"]',
      '[data-test-selector="stream-info-card-component__description"]',
      '[class*="StreamTitle"]',
    ]) {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text) { meta.streamTitle = text; break; }
    }

    for (const sel of [
      'a[data-a-target="stream-game-link"]',
      '[data-a-target="stream-game-link"] span',
      'a[href*="/directory/game/"]',
      'a[href*="/directory/category/"]',
    ]) {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text) { meta.game = text; break; }
    }

    if (!meta.channelDisplayName && activeSession?.channelName) {
      meta.channelDisplayName = activeSession.channelName;
    }

    return meta;
  }

  function buildEntry(session, totalMs) {
    const channelName = session.channelName || `video_${session.vodId}`;
    return {
      channelName,
      channelDisplayName: session.metadata.channelDisplayName || channelName,
      streamTitle:        session.metadata.streamTitle,
      game:               session.metadata.game,
      thumbnailUrl:       session.metadata.thumbnailUrl,
      avatarUrl:          session.metadata.avatarUrl || '',
      vodUrl:             session.metadata.vodUrl || '',
      url:                session.metadata.vodUrl || `https://www.twitch.tv/${channelName}`,
      channelUrl:         session.channelName ? `https://www.twitch.tv/${session.channelName}` : '',
      sessionStart:       session.sessionStart,
      sessionType:        session.sessionType,
      duration:           totalMs,
    };
  }

  function startSession(channelName) {
    if (activeSession) endSession();

    const now = Date.now();
    const previewUrl = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channelName}-320x180.jpg`;

    activeSession = {
      channelName,
      sessionStart: now,
      accumulatedMs: 0,
      lastActiveAt: document.hidden ? null : now,
      metadata: {
        streamTitle: '',
        game: '',
        thumbnailUrl: previewUrl,
        channelDisplayName: channelName,
        avatarUrl: '',
        vodUrl: '',
      },
      metaRetryTimer: null,
      isVod: false,
      vodId: null,
      sessionType: 'live',
    };
    metaRetryCount = 0;

    storage.addOrUpdateEntry({
      channelName,
      channelDisplayName: channelName,
      streamTitle:  '',
      game:         '',
      thumbnailUrl: previewUrl,
      vodUrl:       '',
      url:          `https://www.twitch.tv/${channelName}`,
      channelUrl:   `https://www.twitch.tv/${channelName}`,
      sessionStart: now,
      sessionType:  'live',
      duration:     0,
    }).catch((err) => {
      if (!err.message?.includes('Extension context invalidated')) {
        console.error('[TH] Failed to save entry:', err);
      }
    });

    scheduleMetaRetry();
    if (gqlClientId) fetchLiveData(channelName);
  }

  function startVodSession(videoId) {
    if (activeSession) endSession();

    const now = Date.now();
    const vodUrl = `https://www.twitch.tv/videos/${videoId}`;

    activeSession = {
      channelName: null,
      sessionStart: now,
      accumulatedMs: 0,
      lastActiveAt: document.hidden ? null : now,
      metadata: {
        streamTitle: '',
        game: '',
        thumbnailUrl: '',
        channelDisplayName: '',
        avatarUrl: '',
        vodUrl,
      },
      metaRetryTimer: null,
      isVod: true,
      vodId: videoId,
      sessionType: 'vod',
    };
    metaRetryCount = 0;

    scheduleMetaRetry();
    if (gqlClientId) fetchVodData(videoId);
  }

  async function endSession() {
    if (!activeSession) return;
    const session = activeSession;
    activeSession = null;
    clearInterval(session.metaRetryTimer);

    let totalMs = session.accumulatedMs;
    if (session.lastActiveAt !== null) totalMs += Date.now() - session.lastActiveAt;

    try {
      await storage.addOrUpdateEntry(buildEntry(session, totalMs));
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.error('[TH] Failed to save session:', err);
      }
    }
  }

  function scheduleMetaRetry() {
    if (!activeSession) return;
    clearInterval(activeSession.metaRetryTimer);

    activeSession.metaRetryTimer = setInterval(() => {
      if (!activeSession) return;
      metaRetryCount++;

      const meta = scrapeMetadata();
      let changed = false;

      if (meta.streamTitle && !activeSession.metadata.streamTitle) {
        activeSession.metadata.streamTitle = meta.streamTitle; changed = true;
      }
      if (meta.game && !activeSession.metadata.game) {
        activeSession.metadata.game = meta.game; changed = true;
      }
      if (meta.channelDisplayName &&
          activeSession.metadata.channelDisplayName === (activeSession.channelName || '')) {
        activeSession.metadata.channelDisplayName = meta.channelDisplayName; changed = true;
      }

      if (changed && activeSession.channelName) {
        const duration = activeSession.accumulatedMs +
          (activeSession.lastActiveAt ? Date.now() - activeSession.lastActiveAt : 0);
        storage.addOrUpdateEntry(buildEntry(activeSession, duration)).catch(() => {});
      }

      if (metaRetryCount >= META_RETRY_MAX) clearInterval(activeSession.metaRetryTimer);
    }, META_RETRY_INTERVAL);
  }

  async function fetchLiveData(channelName) {
    if (!gqlClientId || !channelName) return;
    try {
      const resp = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': gqlClientId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            user(login: "${channelName}") {
              displayName
              profileImageURL(width: 300)
              stream { id title game { name } archiveVideo { id } }
            }
          }`,
        }),
      });
      const data = await resp.json();
      const user   = data?.data?.user;
      const stream = user?.stream;
      if (!stream || !activeSession || activeSession.channelName !== channelName) return;

      if (user.displayName)       activeSession.metadata.channelDisplayName = user.displayName;
      if (user.profileImageURL)   activeSession.metadata.avatarUrl          = user.profileImageURL;
      if (stream.title)           activeSession.metadata.streamTitle        = stream.title;
      if (stream.game?.name)      activeSession.metadata.game               = stream.game.name;

      if (stream.archiveVideo?.id) {
        activeSession.metadata.vodUrl = `https://www.twitch.tv/videos/${stream.archiveVideo.id}`;
      }

      const duration = activeSession.accumulatedMs +
        (activeSession.lastActiveAt ? Date.now() - activeSession.lastActiveAt : 0);
      storage.addOrUpdateEntry(buildEntry(activeSession, duration)).catch(() => {});
    } catch (err) {
      console.warn('[TH] GQL error:', err.message);
    }
  }

  async function fetchVodData(videoId) {
    if (!gqlClientId || !videoId) return;
    if (!activeSession?.isVod || activeSession.vodId !== videoId) return;

    try {
      const resp = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': gqlClientId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            video(id: "${videoId}") {
              title
              game { name }
              owner {
                login
                displayName
                profileImageURL(width: 300)
              }
              previewThumbnailURL(width: 320, height: 180)
            }
          }`,
        }),
      });
      const data = await resp.json();
      const video = data?.data?.video;
      if (!video || !activeSession?.isVod || activeSession.vodId !== videoId) return;

      const channelLogin       = video.owner?.login?.toLowerCase() || `video_${videoId}`;
      const channelDisplayName = video.owner?.displayName || channelLogin;

      activeSession.channelName                 = channelLogin;
      activeSession.metadata.channelDisplayName = channelDisplayName;
      activeSession.metadata.streamTitle        = video.title || '';
      activeSession.metadata.game               = video.game?.name || '';
      activeSession.metadata.thumbnailUrl       = video.previewThumbnailURL || '';
      activeSession.metadata.avatarUrl          = video.owner?.profileImageURL || '';

      const duration = activeSession.accumulatedMs +
        (activeSession.lastActiveAt ? Date.now() - activeSession.lastActiveAt : 0);
      storage.addOrUpdateEntry(buildEntry(activeSession, duration))
        .catch((err) => {
          if (!err.message?.includes('Extension context invalidated')) {
            console.error('[TH] Failed to save VOD entry:', err);
          }
        });
    } catch (err) {
      console.warn('[TH] VOD GQL error:', err.message);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!activeSession) return;
    if (document.hidden) {
      if (activeSession.lastActiveAt !== null) {
        activeSession.accumulatedMs += Date.now() - activeSession.lastActiveAt;
        activeSession.lastActiveAt = null;
      }
    } else {
      activeSession.lastActiveAt = Date.now();
    }
  });

  // On unload there's no time to await storage — hand the final entry to the
  // service worker, which can finish the write.
  window.addEventListener('beforeunload', () => {
    if (!activeSession) return;
    let totalMs = activeSession.accumulatedMs;
    if (activeSession.lastActiveAt !== null) totalMs += Date.now() - activeSession.lastActiveAt;
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_HISTORY_ENTRY',
        payload: buildEntry(activeSession, totalMs),
      });
    } catch (e) {}
  });

  window.addEventListener('message', (e) => {
    if (!e.data) return;

    if (e.data.type === '__TH_CLIENT_ID__' && !gqlClientId) {
      gqlClientId = e.data.clientId;
      if (activeSession) {
        if (activeSession.isVod) fetchVodData(activeSession.vodId);
        else fetchLiveData(activeSession.channelName);
      }
      return;
    }

    // VOD id parsed straight from a GQL response by the interceptor.
    if (e.data.type === '__TH_STREAM_DATA__') {
      if (e.data.vodId && activeSession && !activeSession.isVod && !activeSession.metadata.vodUrl) {
        activeSession.metadata.vodUrl = `https://www.twitch.tv/videos/${e.data.vodId}`;
        const duration = activeSession.accumulatedMs +
          (activeSession.lastActiveAt ? Date.now() - activeSession.lastActiveAt : 0);
        storage.addOrUpdateEntry(buildEntry(activeSession, duration)).catch(() => {});
      }
    }
  });

  function init() {
    const datasetClientId = document.documentElement.dataset.thClientId;
    if (datasetClientId && !gqlClientId) gqlClientId = datasetClientId;

    window.TwitchRouter.onRouteChange((newPath, oldPath) => {
      const oldChannel = getChannelFromPath(oldPath);
      const oldVodId   = getVodIdFromPath(oldPath);
      const newChannel = getChannelFromPath(newPath);
      const newVodId   = getVodIdFromPath(newPath);

      if (oldChannel || oldVodId) {
        if (oldChannel !== newChannel || oldVodId !== newVodId) endSession();
      }

      if (newChannel && newChannel !== oldChannel) startSession(newChannel);
      else if (newVodId && newVodId !== oldVodId) startVodSession(newVodId);
    });

    const initialChannel = getChannelFromPath(location.pathname);
    const initialVodId   = getVodIdFromPath(location.pathname);
    if (initialChannel) startSession(initialChannel);
    else if (initialVodId) startVodSession(initialVodId);
  }

  return { init };
})();
