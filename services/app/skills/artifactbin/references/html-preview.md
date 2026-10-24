---
name: html-preview
description: Private loopback preview of an HTML project with bundled offline core and local assets.
---
## Read first

Preview serves a selected directory on loopback with local runtime modules and a restrictive browser resource policy. It never publishes. This is not a complete network sandbox for hostile JavaScript.

## Run

From the extracted HTTP author skill, run `node scripts/preview.mjs /absolute/path/to/project --port 7474` and open the printed loopback URL. The selected directory must contain `index.html`; relative images, styles, scripts and JSON files resolve normally. Use a dedicated project directory containing only files intended for preview. Dotfiles, directory listings, path traversal and symlinks outside that directory are refused. Reads hold a bounded file descriptor and reject a substituted leaf symlink. This is not a filesystem sandbox against a hostile process concurrently replacing ancestor directories: Node does not expose a portable directory-relative open capability. Static files use GET/HEAD. Only declared local dataset sessions accept same-origin JSON POST operations; those edits remain in memory. The server never writes files, uploads, publishes, signs in or reads account credentials. Stop with Ctrl-C. No page or node IDs are required.

The downloaded skill includes its core and Apollo modules; `/af/v1/core.js` loads locally without fetching the platform. Keep the normal core script tag. Viewer-local Apollo state works in this browser. A top-level raw page has the runtime's offline default and cannot attach the remote reader bridge; frames are prohibited. Remote dataset/backend fields remain unavailable offline. Relative CSV/JSON dataset declarations use the local session adapter described below. `fetch('./data.json')` can read local project data. Published `ref:` assets must be replaced with local files or data URLs for preview.

The private preview CSP blocks remote subresources, fetch/WebSocket connections, frames, forms and workers; external libraries/fonts must be copied into the project. This is ordinary local HTTP, **not an absolute privacy sandbox for hostile JavaScript**: Same-window HTTP navigation can leave the preview origin even with this CSP sandbox (verified in Chromium). Browser extensions, browser features and user actions are also outside this policy. Sandbox permissions do not allow popups, but do not treat that as complete network isolation. For a strict no-network guarantee, use a browser/OS sandbox with outbound networking disabled. Do not preview untrusted code in a browser profile containing sensitive sessions.

Repository source users can supply prebuilt public core/module assets with `--runtime-dir DIR` (mounted at `/af/v1/`); the installed archive needs only Node and already contains them. Never put credentials or unrelated files in either served directory. Local preview does not perform publication validation or prove the published page works.

## Disk edits and reload

While open, preview polls the selected project tree every 1.5 seconds. Changes to the entry HTML or local dependencies (including new files, deletion and atomic editor saves) show **File changed → Reload** in a separate notice. The existing page keeps running until the viewer clicks Reload. This is an invalidation notification, never a DOM patch or publication. Ordinary browser reload runs page initialization again; only state explicitly persisted by the app survives. Apollo viewer-local state remains subject to its normal browser storage contract.

Rapid writes between polls may coalesce; preview observes current file contents, not a complete edit history. The project is limited to 2,000 visible files, 32 MiB per file and 128 MiB in total. All tabs share an in-flight scan and a one-second revision cache; limits produce an explicit error in the top notice. Keep large unrelated directories outside it. Hidden files and outside symlinks do not contribute revisions. A disconnected notice retries automatically; page exit stops polling and an actual return to the page resumes it. Deleting the entry file produces a change notice. Reloading a clean page then returns 404 until it exists again; a dirty dataset session instead shows a recovery page with export/discard controls. A connection to a hosted page does not monitor local disk: this helper must remain running for disk notifications.

The server serializes a preview-only `data-af-private-preview="true"` attribute onto `<html>` before any source/core script executes. This suppresses runtime auto-connection in addition to the enforced resource policy. The source file is never rewritten. The top notice emits `af:preview-status` with disk-change/scan connectivity only; it does not assert remote backend connectivity.

## Declared local datasets

Use the same namespace declaration with a relative CSV or JSON file:

```html
<link rel="af-dataset" data-af-name="sales" href="./sales.csv">
```

The preview builds the normal dataset GraphQL namespace from that file. `data-af-table` optionally names the table (otherwise the filename stem); `data-af-schema` optionally overrides `main`. JSON must contain an array of row objects. Multiple links with the same namespace combine their declared tables. Absolute remote URLs and `ref:` links do not become local datasets. Viewer-local Apollo fields and these explicit local namespaces work without a remote connection.

Dataset mutations affect the current server session only. They never change CSV/JSON files or a published dataset. To keep edits, explicitly download the JSON snapshot at the injected runtime config's `localPreview.endpoint + '/export/NAME'`, replacing NAME with the declared namespace; saving or converting that export is a separate deliberate agent action. Stopping/restarting the helper loses unexported edits. Dirty sessions survive idle expiry and are never silently evicted; a full registry rejects new pages until the viewer exports and explicitly discards a session. For a dirty session, Reload first offers export links and a separate **Reload and discard local edits** confirmation. A native browser reload also retains that dirty session if source/dependency files changed, and reports a source conflict. Only explicit discard resets it to current disk data. Clean sessions refresh normally.

The registry holds at most four sessions, expires clean sessions after 30 idle minutes, limits each to 512 operations and four concurrent operations, and bounds request JSON to 64 KiB with a five-second operation abort signal. Declared data is limited to 8 MiB per file and 16 MiB per session; served static files retain the separate 32/128 MiB project bounds above. These are preview resource limits, not publication or account permissions.

Explicit local Save tooling can read `GET /__af_preview/source?path=ENCODED_PATHNAME` for unchanged source HTML and `GET /__af_preview/export-runtime` for bundled browser code. Neither endpoint reads account state or writes a file; saving remains a deliberate viewer/agent action.
