---
name: publication-bundles
description: "Publishing native HTML with local project dependencies."
---
## Read first

Snapshot a bounded project with the helper, retain its immutable request and receipt map, and publish through the normal authenticated HTTP API. Local source stays unchanged; dependencies publish before the page. Reuse the same request after uncertain results.

## Contents

- [Prepare and send](#prepare-and-send)

## Prepare and send


Prepare a native project snapshot without changing author files:

```sh
node scripts/publication-bundle.mjs ./project index.html https://SERVER REQUEST.json
node scripts/publication-bundle.mjs --send REQUEST.json
```

Supply the selected server origin. The helper confines reads to the project root,
refuses symlinks, and discovers static HTML URLs, CSS `url()` / `@import` paths,
and static or literal dynamic module imports, including inline module scripts.
An optional fifth argument names a JSON file containing `manifest` (additional
relative file paths) and `mappings` (previous returned dependency receipts keyed
by path). List other runtime-loaded files in that explicit manifest. The server
parses and rewrites literal module imports. Computed imports and cyclic dependency
graphs are refused, except a private `const` arrow adapter used only in direct calls
with literal `data:`/`blob:` URLs, a literal string-array URL join, or
`URL.createObjectURL(new Blob([...literal strings], {type:"text/javascript"}))`.
These runtime-created URLs are not project files. The saved import checks that its
actual argument remains a `data:` or `blob:` string; relative, bare and unknown
arguments, escaped adapters and coercible objects remain refused. This does not
change the page CSP or make computed imports portable in an offline export.
The snapshot is bounded to 99 files, 4 MB per file and 16 MB total decoded bytes.
Remote URLs, absolute server paths and `ref:` dataset links remain unchanged.
The server validates existing dataset permissions as usual.

The HTTP `publicationBundle` field contains `entryPath`, `files` with `path`,
`contentType`, and canonical padded `base64`, and optional `mappings`. A mapping
contains `kind` (`asset` or `dataset`), `id`, observed `revision`, and the returned
`sha256` when local bytes are retained; the server
checks ownership, kind and current revision and derives its own URL. Mappings reuse unchanged content. Changed local files update the same resource ID
conditionally against the mapping revision and state; datasets keep their own
revision. A concurrent remote change returns a conflict instead of overwriting it.
Keep returned path receipts, including state and revision, for the next update. Unchanged dependency receipts may also be supplied when creating other pages on the same server with the same authorized account; verify local byte digests and the full dependency closure before reusing them.

The send helper saves `REQUEST.json.receipt.json` with the returned path mapping,
including partial-success receipts. Keep the saved request and idempotency key. Dependencies use actor-owned reserved
IDs and durable creation receipts; the page is created after all dependencies.
Both success and partial failure return `dependencyReceipts` containing paths,
kinds, IDs and revisions. Retry the identical saved request after an uncertain
result; it reuses completed dependencies. For later conditional page updates,
retain the path mapping, use `PUT` with the existing page ID and observed version
and state, and choose a new idempotency key. The local author HTML stays portable.


### Scoped private dependency access

A page’s immutable dependency admission delegates access through its scoped
asset door. Every read checks the current page ACL and the current page owner’s
permission to read the admitted child. Sharing the page later works without
changing the child’s direct private URL or ACL. Removing someone’s independent
child grant does not remove their page-delegated grant while they can still read
the page. Remove the page grant, remove the binding in a new page version, or
revoke the current owner’s child access to revoke that scoped access. Ownership
transfer uses the new current owner’s permissions, never source-supplied identity.
Local `af-backend` links select named TypeScript files into the existing atomic
`backendSources` publication; backend files are never uploaded as public assets.
