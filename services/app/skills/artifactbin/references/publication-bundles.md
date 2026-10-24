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
refuses symlinks, and discovers static HTML URLs and CSS `url()` / `@import` paths.
An optional fifth argument names a JSON file containing `manifest` (additional
relative file paths) and `mappings` (previous returned dependency receipts keyed
by path). Include JavaScript module dependencies in that explicit manifest; the
server parses and rewrites literal module imports. Computed imports are refused.
The snapshot is bounded to 99 files, 4 MB per file and 16 MB total decoded bytes.
Remote URLs, absolute server paths and `ref:` dataset links remain unchanged.
The server validates existing dataset permissions as usual.

The HTTP `publicationBundle` field contains `entryPath`, `files` with `path`,
`contentType`, and canonical padded `base64`, and optional `mappings`. A mapping
contains `kind` (`asset` or `dataset`), `id`, observed `revision`, and the returned
`sha256` when local bytes are retained; the server
checks ownership, kind and current revision and derives its own URL. Mappings
reuse content; they never overwrite a dataset. If mapped local bytes change, publication refuses
until you update that dependency separately with its own conditional write. Update that dataset separately
with its own observed version/state before changing its mapping revision.

The send helper saves `REQUEST.json.receipt.json` with the returned path mapping,
including partial-success receipts. Keep the saved request and idempotency key. Dependencies use actor-owned reserved
IDs and durable creation receipts; the page is created after all dependencies.
Both success and partial failure return `dependencyReceipts` containing paths,
kinds, IDs and revisions. Retry the identical saved request after an uncertain
result; it reuses completed dependencies. For later conditional page updates,
retain the path mapping, use `PUT` with the existing page ID and observed version
and state, and choose a new idempotency key. The local author HTML stays portable.
