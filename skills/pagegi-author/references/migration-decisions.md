# Author contract decisions

These decisions record the HTML author's current contract. They describe shipped code and its limits; they are not a claim that every migrated page has been verified in production.

## Backend watches refresh authoritative data

`client.watchQuery` watches both top-level local fields and backend namespaces. Backend mutations, authorized server invalidations and reconnects refresh watched backend results without page polling. Remote fields begin as `null`; refused or failed reads report errors rather than becoming local state. Authors must render the watch results directly and unsubscribe when a view is removed.

Implementation: `src/apollo/client.ts`, `src/apollo/watch-query.ts`, `src/browser/remote-bridge.ts`. Behavioral coverage: `test/remote-watch.unit.test.ts`, including two viewers and reconnect recovery. See [State](state.md) and [Backends](backend.md).

## Shared results do not become viewer state

Backend query results stay separate from the viewer's canonical local document. `updateQuery` changes local fields only; filters, drafts and selections belong there. A downloaded page includes the downloading viewer's local state, not a durable copy of backend results. Fresh backend reads require a connection, and disconnected backend mutations settle as `offline`.

Comments and shared viewer snapshots separately retain the rendered view and local state. Saved views display that rendering read-only and inert; they do not replay shared writes or turn captured shared results into current backend data. Do not promise an offline live backend or put account credentials in a download.

Implementation: `src/apollo/client.ts`, `src/browser/comment-wire.ts`, `src/browser/document-view.ts`. Behavioral coverage: `test/v2/apollo/remote.unit.test.ts` (remote results never enter the local store), `test/v2/integration/local-state.browser.test.ts` (saved view is inert). See [State](state.md) and [HTTP API](http-api.md).

## Delete means indefinitely recoverable trash

Deleting marks a file as trashed. Its identity, versions, comments and charged storage remain; ordinary file routes stop serving it. The trash API restores the same identity and history. A restore refuses a live path collision instead of overwriting another file, and falls back to the root when the original parent no longer exists. There is no automatic expiry or author-facing permanent purge endpoint.

Implementation: `src/server/af-pages.ts` (`remove`), `src/trash/service.ts`, `src/trash/model.ts`. Behavioral coverage: `test/v2/server/trash.database.test.ts`, `test/v2/page/trash.unit.test.ts`. See [HTTP API](http-api.md).

## Handles permit underscores

Handles are 3–32 characters, normalized by trimming and lowercasing. They accept lowercase letters, digits and underscores, plus single inner hyphens. Underscores may repeat or appear at either end; hyphens may not lead, trail or repeat. Reserved platform names remain unavailable. Handle rules do not grant access to a page.

Implementation: `src/server/handles-contracts.ts`, `src/server/handles.ts`. Behavioral coverage: `test/v2/server/handles-policy.unit.test.ts`. See [HTTP API](http-api.md).

## Skill identity and installation

The agent-facing skill name is `artifactbin-author`, declared in the skill's frontmatter. Its served installation package is `https://app.artefactbin.dev/skills/artefactbin-skill.tgz`. The repository directory `skills/pagegi-author/` is an internal source location retained for compatibility with build scripts and tests; it is not a second skill or a separate product installation. The installer installs the author skill. Authoring uses the documented HTTP API and the skill's helper scripts; it does not require an end-user CLI.
