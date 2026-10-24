---
name: html-preview
description: Private loopback preview of an HTML project with bundled offline core and local assets.
---
## Read first

Preview serves a selected directory on loopback with local runtime modules and a restrictive browser resource policy. It never publishes. This is not a complete network sandbox for hostile JavaScript.

## Run

From the extracted HTTP author skill, run `node scripts/preview.mjs /absolute/path/to/project --port 7474` and open the printed loopback URL. The selected directory must contain `index.html`; relative images, styles, scripts and JSON files resolve normally. Use a dedicated project directory containing only files intended for preview. Dotfiles, directory listings, path traversal and symlinks outside that directory are refused. GET/HEAD only; the server never saves, uploads, publishes, signs in or reads account credentials. Stop with Ctrl-C. No page or node IDs are required.

The downloaded skill includes its core and Apollo modules; `/af/v1/core.js` loads locally without fetching the platform. Keep the normal core script tag. Viewer-local Apollo state works in this browser. A top-level raw page has the runtime's offline default and cannot attach the remote reader bridge; frames are prohibited. Shared dataset/backend fields remain unavailable offline; this is not a local GraphQL dataset service. `fetch('./data.json')` can read local project data. Published `ref:` assets must be replaced with local files or data URLs for preview.

The private preview CSP blocks remote subresources, fetch/WebSocket connections, frames, forms and workers; external libraries/fonts must be copied into the project. This is ordinary local HTTP, **not an absolute privacy sandbox for hostile JavaScript**: CSP does not reliably prohibit every top-level navigation, browser extension, browser feature or user action. Sandbox permissions do not allow popups, but do not treat that as complete network isolation. For a strict no-network guarantee, use a browser/OS sandbox with outbound networking disabled. Do not preview untrusted code in a browser profile containing sensitive sessions.

Repository source users can supply prebuilt public core/module assets with `--runtime-dir DIR` (mounted at `/af/v1/`); the installed archive needs only Node and already contains them. Never put credentials or unrelated files in either served directory. Local preview does not perform publication validation or prove the published page works.
