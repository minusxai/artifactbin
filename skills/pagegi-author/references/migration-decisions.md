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

The agent-facing skill name is `artifactbin-author`, declared in the skill's frontmatter. Its served installation package is `https://app.artefactbin.dev/skills/artefactbin-skill.tgz`. The repository directory `skills/pagegi-author/` is an internal source location retained for compatibility with build scripts and tests; it is not a second skill or a separate product installation. Both npm and shell installers install it into `artifactbin-author`; the archive still has the internal `pagegi-author` root. On upgrade an old `pagegi-author` installation is moved intact to `~/.af/skill-backups/`, outside agent discovery. Both installers configure the examples and scripts for the selected server origin. The installer installs the author skill. Authoring uses the documented HTTP API and the skill's helper scripts; it does not require an end-user CLI.

## Imported group libraries retain distinct ownership

The signed-in library offers personal and imported group namespaces derived from current active memberships. Selecting a group changes its listing and folder navigation, never the signed-in identity. Group viewers browse; group editors also manage folders and paths. Every operation rechecks membership. New HTML publication and examples remain personal: group backend publication, membership administration and account secrets are not exposed through this selector.

Original group handles are a separate metadata preservation step. A namespace may have no handle; its owner-scoped library remains usable. Restoring handles must validate original source mappings, current global collisions and existing migration verification rules before applying an idempotent metadata update. Navigation does not create group login credentials or silently assign a new handle.

## Bounded legacy scalar mutation conversion

Offline prototype migration preserves named local mutations of the form `UPDATE _signals SET count=count+1` as typed viewer state operations. The target and source must be declared number Values; addition and subtraction accept nonnegative safe integer literals. Null remains null. The archived SQLite compiler validates the rewritten statement and every original control binding before conversion. Named Button actions and managed frame mutation callbacks use the same serialized local mutation adapter as table mutations.

The adapter rejects unsafe integers, concurrent viewer edits and invalid result types before committing. Other `_signals` expressions, clauses, multi-statement SQL, reset directives, affected-row guards and composition with shared bindings are refused. This compatibility path grants no backend or account authority and is not an authoring API.

Managed frame normalization adds the versioned `scalar-params-v1` compatibility extension while retaining the pinned original codemod hash. Literal declared scalar `mx.params.get(name)` reads synchronously, and `set(name, value)` writes synchronously. The historical one-argument `subscribe(listener)` supplies the full scalar map after changes, without an initial callback, and returns an unsubscribe function. Subscriptions also stop when the authored component unmounts.

The observed two-argument `subscribe([names], listener)` form is an explicit compatibility repair: literal declared scalar names select the callback map and dependencies, and the callback receives an initial snapshot. This repair follows the authored intent; it is not claimed to be the historical one-argument API. Computed names, unknown values and unsupported bridge calls are refused. These scalar bridge rules apply to frames without mutations too. Local mutation callbacks have a separate viewer-only port; registered remote callbacks retain their access and authorization checks.
## Legacy named dataset operations

Offline migration can derive ordinary Import bindings from literal source-qualified Query and Mutation declarations only after verifying their stored dataset catalogs and row objects. The derived document keeps operation names, node identities, dependent queries, and typed row parameters. Source routing is never inferred for external or unavailable catalogs. Originals and every saved revision remain unchanged in the archive.

The compatibility compiler lowers only the observed list expressions into SQLite JSON operations, including nullable string-list casts, list aggregation, list length and joining, numeric least/greatest, JSON list construction, and the bounded single-list allocation projection. Unknown set-returning forms refuse conversion. A page with only registered dataset mutations retains those operations without an invented read query; ordinary backend authorization and durable mutation recovery still apply.

Ambiguous list identifiers and numeric extrema require a versioned operator audit bound to the SHA256 of that exact original SQL statement. The audit lists the expressions proved to contain lists or numbers; it does not authorize backend access. Without that evidence, string `len` and mixed or unknown extrema types refuse conversion. Audits partition conversion cache identity. Unrelated SQL is never assigned list types because another query uses a source binding.
