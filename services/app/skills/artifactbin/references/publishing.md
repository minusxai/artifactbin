---
name: publishing
description: "Rules and invocations for publishing."
---
## Read first

A .jsx file has a YAML fence and static JSX body. The fence carries document metadata. Preserve exactly the identity fields returned; never add `version` when absent. `version` is an optional historical selection, distinct from `head_version`; preserve it when returned. Portable local identity, history and comments live in the workspace .artifactbin directory; credentials remain in your private home state. Keep that workspace state with the folder when moving it. Explicit push creates a per-server publication copy and local-to-remote ID mapping under .artifactbin/publications without replacing local IDs. Omitted push paths select registered and tracked files. Missing tracked files are skipped. Referenced unpublished IDs publish first; explicitly push a published dataset to update it.

A CLI reference is <url|id|path>[@version]; an existing complete filename wins over an id. Published references inside markup use ref:<id>. Run afbin add --json to assign local IDs before authoring references. Publication maps those IDs and ref: references to reserved remote IDs in its server copy; the local source keeps its local identity. Existing remote documents retain their remote identity when edited.

Run afbin validate report.jsx before publishing; validate --fix applies mechanical fixes. status and diff use saved state; add --remote only to refresh a comparison. An unchanged push makes no request. push --dry-run performs authoritative server validation without publishing or saving state.

Successful writes return canonical source and identity in the same response. Push preserves edits made while the request was in flight. Retry an uncertain write with push: its frozen journal recovers the original result. A refused conflict leaves your proposal untouched and supplies a diff. pull --force overwrites local changes, so preserve a wanted proposal first; it keeps the replaced bytes under ~/.artifactbin/backups/local and reports that absolute path, archives a pending conditional proposal before replacing the working file, and cannot cancel an uncertain create. push --force observes and conditionally replaces the remote head; it never fixes markup. Deleted create results remain retired.

To adapt a document you can read, run afbin fork <ref>: it writes a private local draft without identity or invitations and records forked_from; push creates the copy. Forking a page that WRITES datasets is different: those datasets are copied under your account and the page is repointed at your copies on the server, so the fork answers status created with the id and url of that copy, and the local file is already tracked against it — edit and push to update it, never to publish a second page. fork --dry-run names the datasets first; datasets a page only reads stay shared. A historical pull keeps the current head conditions separately; pushing it performs a conditional replacement.

## Published identities and account pins

A pulled or copied complete published fence selects the original artifact, including in a marked local workspace. Partial or stale copied conditions refuse before reservation or publication. Successful bound updates return canonical bytes and accepted tracking to the authoring file; offline local drafts retain their local IDs. Conflicts appear on the original status; pull --force refreshes its publication projection after uncertain writes have been recovered.

status labels workspace, credential and publication accounts as last observed. workspace_account_mismatch names the pinned and authenticated accounts plus pin locations. Plain afbin auth verifies saved credentials; afbin auth --email <email> selects the intended account. To explicitly keep this directory under current credentials, run afbin workspace rebind --account current --dry-run, then repeat without --dry-run. This only changes local account pins: no ownership transfer, publication or permission grant. Pending operations refuse rebind. Previously published local drafts retain their old targets in archived metadata and require an explicit pull or fork; brand-new drafts may publish under the new account.

## Local preview

Run `afbin preview report.jsx appendix.jsx` or `afbin preview .` to view and edit files without publishing. Run `afbin preview --port 7474` without paths for an empty import server: open its URL to Import an HTML file, or choose Connect to server in an offline .jsx.html file and enter http://localhost:7474. Confirm the workspace filename with Import and open. The original HTML stays unchanged; the server imports a copy with existing validation/conflict checks, then browser edits and comments save to that workspace. No other files are implicitly selected. Compatible hosted preview services use an explicit HTTPS reverse-proxy origin declared with --public-url https://preview.example.com; it does not change the listening interface. Browser saves write to disk; clean viewers refresh after external changes. Local comments stay in client SQLite. `--share` lets anyone reaching the foreground session edit and comment on selected files. Stop with Ctrl-C.

Run `afbin add <files> --json` to obtain stable IDs before writing cross-file references. Artifact source uses `ref:ID` for datasets/media and `/a/ID` for document links. Preview resolves registered local files first and other IDs through the workspace host/account. Push publishes unpublished dependencies under their reserved IDs; no path-reference rewriting occurs. Preview and push register directly named files automatically. Local preview can differ from published content until edits are pushed. Preview never increments server versions or changes the saved remote baseline.

## Identity and authored scripts

Every body element has a persistent id for its lifetime. Move a node with the same id; never reuse an id for another node. Preserve existing data-annotation-anchor values with their element; never author, change or reuse one. New comments do not add it.

The Helmet script runs in the document as an ES module: it binds the declared names from `page` as Solid signals (`signal('$name')`, `query`, `mutation`) and libraries by npm name or https URL, and reaches other hosts only through `proxy(url)` from `page`, to hosts the Helmet declares with `csp-connect` and the reader allows. Account APIs, cookies and the app's storage stay out of reach.

See [authentication](publishing-auth.md) for how afbin signs in. Full replacement, metadata and folder settings are fields of the file you push.
