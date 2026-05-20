# Twitch History

A Chrome extension that adds a watch-history feature to Twitch — like YouTube's
history, but for the channels and VODs you watch.

Twitch has no record of what you've watched. This extension keeps one locally:
every channel and replay you open is logged with its watch time, and a full-page
history view is added straight into the Twitch UI.

## Features

- Records every channel and VOD you watch, along with how long you watched
- Full-page history view injected into Twitch, with search and pagination
- Per-session tracking: revisiting a channel within 30 minutes extends the
  existing session instead of creating a duplicate
- "Rewatch" button that jumps to a stream's VOD when one is available
- Import and export the whole history as JSON
- Configurable minimum watch time and history size
- All data stays local — nothing is sent anywhere

## Installation

The extension is loaded unpacked:

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Open [twitch.tv](https://www.twitch.tv) — a **History** entry appears in the
   left sidebar. The toolbar icon opens the same view.

## How it works

Twitch is a single-page React application, which makes a few things non-trivial:

- **Route detection** — Twitch's router captures `history.pushState` before any
  extension code runs, so patching it would miss navigations. The extension
  instead polls `location.pathname` and observes the `<title>` element, which
  Twitch rewrites on every navigation.

- **Metadata** — channel names, stream titles, games, thumbnails and avatars
  come from Twitch's GraphQL API. Calling it requires a `Client-ID` header,
  which a `document_start` script running in the page's main world recovers
  from inline scripts or the first GraphQL request. DOM scraping fills the gap
  while that request is in flight.

- **Watch time** — time is accumulated only while the tab is visible
  (`visibilitychange`). On page unload there's no time to await storage, so the
  final entry is handed to the Manifest V3 service worker, which completes the
  write.

## Project structure

```
src/
  background/
    service-worker.js     MV3 service worker (unload writes, toolbar action)
  content/
    interceptor.js        main-world script that recovers the GQL Client-ID
    router.js             SPA navigation detection
    tracker.js            watch-time tracking and GQL metadata
    history-view.js       the full-page history overlay
    sidebar.js            injects the sidebar button
    content.js            content-script entry point
  storage/
    storage-manager.js    chrome.storage.local data layer
  styles/
    history-view.css      overlay and sidebar styles
  popup/                  toolbar popup (html / css / js)
  utils/
    helpers.js            shared utilities
tools/
  generate-icons.py       regenerates the extension icons
manifest.json
```

## Tech

Vanilla JavaScript and Chrome Extension Manifest V3, using `chrome.storage.local`
for persistence. No build step and no dependencies — the source in this
repository is exactly what runs in the browser.

## Privacy

The extension stores its data only in `chrome.storage.local`, on your machine.
It talks to Twitch's own API and never sends data to any third party.

## License

[MIT](LICENSE)
