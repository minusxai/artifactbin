---
name: local-files
description: Author, preview, connect, save and publish ordinary local HTML without confusing local bytes with hosted source.
---
## Read first

A page is an ordinary HTML file loading `<script src="/af/v1/core.js" data-af="core"></script>`. Edit source with normal tools. There is no in-app source editor. Keep stable `data-af-id` values and every saved remote version.

An **unpublished** file has no published page identity. A **reserved** ID is only an allocation for a later write; it does not create a hosted page, grant access or make the file linked. A **linked** portable HTML copy carries the original platform origin, page ID and saved source revision/digest. That provenance is public metadata, never a credential or proof of current permission. Merely editing or opening a file does not publish it.

## Preview before publication

Run `node scripts/preview.mjs PROJECT_DIR` from the extracted author skill and open its loopback URL. Use a dedicated directory containing only intended project files. The installed helper needs Node and includes its runtime assets. It serves local files, never uploads or writes them. Its private-preview marker suppresses remote auto-connection. Read [private preview](html-preview.md) for resource bounds and browser-network limitations; use network isolation when an absolute no-network guarantee is required.

Relative images, styles and scripts remain project paths. Copy required libraries/fonts locally. A `ref:ID` denotes an existing platform resource, not a local filename, and is not resolved as a local preview asset. For example, a local dataset declaration is:

```html
<link rel="af-dataset" data-af-name="sales" href="./sales.csv">
```

The preview supplies the documented dataset GraphQL namespace from that declared CSV or JSON array of row objects. Table names default to the filename stem; `data-af-table` and `data-af-schema` can override them. Local dataset edits are session-only. They do not modify source CSV/JSON or a remote dataset. Export the session snapshot and deliberately save/convert it when edits must survive stopping the helper. Remote backend and dataset namespaces remain unavailable offline; no local backend resolver execution is implied. Viewer-local state through `client` from `@afbin/apollo` continues to work.

Agent edits produce **File changed → Reload**, rather than patching the running page. Reload explicitly to run changed source. Dirty dataset sessions offer export and a separate discard confirmation; native reload does not silently replace them with disk data. Export/discard before intentionally resetting a dirty session. See the preview guide for recovery and bounded-session behavior.

## Open a linked HTML copy

A linked portable file normally attempts to connect to its original platform. **Stay offline** remembers that viewer's choice for this page; **Connect** retries the original destination. Private preview stays local. An unpublished file has no original destination to connect to. A linked file's destination is not an editable server selector.

Sign-in, permission checks, comments and presence belong to the platform-owned interface. The platform rechecks current access; a local identity block or readable page grants no write authority. Local source never receives account tokens. Offline source, connection status and source comparison are separate facts: connecting does not upload edits, and a successful connection does not prove that the disk file matches remote source.

## Compare actual source

An automatically opened HTML document cannot inspect the current disk file. Embedded saved source and its identity describe a baseline, not proof of present author bytes. **Save HTML** asks for the current HTML file; private preview can instead supply actual source through its local helper after the explicit Save action. Runtime bootstrap and live DOM changes are excluded from recovered author source.

Comparison uses digests of baseline **B**, actual local source **L**, and the current authorized remote observation **R**. All equal means match; L=B with changed R means behind; R=B with changed L means local edits; all differ means diverged; L=R with a different B means converged. A remote revision may advance without changing bytes. Missing baseline, unread local file and unavailable remote observation remain distinct uncertainties. No status automatically merges, overwrites, pulls or publishes. Any later remote replacement uses the current observed remote revision/state for its conditional write, rather than trusting the saved baseline.

## Save a copy or publish deliberately

**Save HTML** downloads a new portable copy; it does not overwrite the original disk file or publish. The current viewer's private filters/drafts are included only when explicitly opted in. Credentials are always excluded. After publication, save the linked HTML copy to retain its returned identity on disk.

For publication with project dependencies, use [publication bundles](publication-bundles.md). Local author paths remain unchanged; the published snapshot receives returned resource IDs and URLs. Keep the saved request, idempotency key and dependency receipts, including partial-success receipts. Existing `ref:` bindings retain their original permissions. Creating an unpublished page and conditionally updating an existing linked page are different writes: preserve the page ID and observe its current version/state before replacement. Never infer publication success from a reservation, a local save, a connection or an uncertain response.
