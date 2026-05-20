/*
 * Runs in the page's MAIN world at document_start. Twitch's GraphQL API needs a
 * Client-ID header; this script recovers that ID and forwards it to the
 * isolated-world content scripts, and watches GQL responses for VOD ids.
 */
(function () {
  'use strict';

  if (window.__TH_INTERCEPTOR__) return;
  window.__TH_INTERCEPTOR__ = true;

  const GQL_HOST = 'gql.twitch.tv';
  const KNOWN_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

  let posted = false;

  function postClientId(cid) {
    if (!cid) return;
    // Stored on the <html> dataset too, so isolated-world scripts that load
    // after this postMessage fires still have a way to read the id.
    document.documentElement.dataset.thClientId = cid;
    if (posted) return;
    posted = true;
    window.postMessage({ type: '__TH_CLIENT_ID__', clientId: cid }, '*');
  }

  function tryReadFromInlineScripts() {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const t = s.textContent;
      if (!t) continue;
      const m = t.match(/[\"']?client[-_]?[Ii][Dd][\"']?\s*[:=]\s*[\"']([a-z0-9]{20,40})[\"']/i);
      if (m) return m[1];
    }
    return null;
  }

  function extractClientId(headers) {
    if (!headers) return null;
    try {
      if (typeof headers.get === 'function') {
        return headers.get('Client-ID') || headers.get('client-id') || null;
      }
      const keys = Object.keys(headers);
      const k = keys.find((k) => k.toLowerCase() === 'client-id');
      return k ? headers[k] : null;
    } catch (e) {
      return null;
    }
  }

  // Resolution order: inline page scripts, then the headers of the first GQL
  // request, then Twitch's well-known web client ID as a last resort.
  const fromInline = tryReadFromInlineScripts();
  if (fromInline) postClientId(fromInline);

  document.addEventListener('DOMContentLoaded', () => {
    if (!posted) postClientId(tryReadFromInlineScripts());
    if (!posted) postClientId(KNOWN_CLIENT_ID);
  });

  setTimeout(() => {
    if (!posted) postClientId(tryReadFromInlineScripts() || KNOWN_CLIENT_ID);
  }, 2000);

  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = (typeof input === 'string' ? input : input?.url) || '';

    if (url.includes(GQL_HOST)) {
      if (!posted) {
        const cid = extractClientId(init?.headers)
          || (input instanceof Request ? extractClientId(input.headers) : null);
        if (cid) postClientId(cid);
        else if (!posted) postClientId(KNOWN_CLIENT_ID);
      }

      const response = await _fetch.call(this, input, init);
      try { response.clone().text().then(parseResponse).catch(() => {}); } catch (e) {}
      return response;
    }

    return _fetch.call(this, input, init);
  };

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.includes(GQL_HOST)) this.__th_gql = true;
    return _open.apply(this, arguments);
  };

  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__th_gql && name.toLowerCase() === 'client-id') postClientId(value);
    return _setHeader.apply(this, arguments);
  };

  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__th_gql) {
      this.addEventListener('load', () => {
        try { parseResponse(this.responseText); } catch (e) {}
      });
    }
    return _send.apply(this, arguments);
  };

  function parseResponse(text) {
    if (!text || text.length > 2_000_000 || !text.includes('archiveVideo')) return;
    const m = text.match(/"archiveVideo"\s*:\s*\{\s*"id"\s*:\s*"(\d{6,})"/);
    if (m) {
      window.postMessage({ type: '__TH_STREAM_DATA__', vodId: m[1] }, '*');
    }
  }
})();
