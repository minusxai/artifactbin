# Native HTML documents

Publish a complete HTML document in the `html` field. Ordinary HTML, CSS, browser
JavaScript and ES modules are the source format. JSX `markup`, `Helmet` declarations
and prepared `document_update` graphs are retired publication inputs.

```json
{"html":"<!doctype html><html><head><title>Report</title></head><body><h1>Report</h1></body></html>"}
```

The server returns canonical HTML with stable `data-af-id` identities and one
blocking `/af/core.js` script before author scripts. Read and edit that returned
source; preserve IDs on surviving elements and never reuse a removed ID. Duplicate
IDs, including inside templates, are refused. Script-created comment targets need
stable IDs under a saved source ancestor. Source is distinct from served runtime
wrappers; do not copy a reader's injected DOM into a publication.

`GET /api/artifacts/ID` returns the saved `html`, `version`, `edit_id` and `state`.
Replace with `PUT /api/artifacts/ID`, sending the complete `html`, observed
`expectedVersion` and `expectedState`. A stale save conflicts rather than silently
overwriting another edit. Revert creates a new version; IDs and the artifact URL
remain governed by the same history and access checks. Comments are sidecar
relations, read separately from `/api/artifacts/ID/annotations`.

## State, shared data and code

The core supplies import mappings for hosted components, libraries and
`@afbin/apollo`. The authoring reference lives in
`services/app/skills/artifactbin`: its runtime, backends, datasets and component
sources describe the public contract served by `/llms/…` and the skill archive.

| Need | Native contract |
| --- | --- |
| Viewer-local state | Inert JSON in `<script type="application/json" data-af="state">`; read, watch and update through `@afbin/apollo`. State persists privately in that viewer's browser. |
| Dataset | `<link rel="af-dataset" data-af-name="sales" href="ref:DATASET_ID">`; live by default, or `data-af-mode="pinned" data-af-revision="2"`. Read and write it with `` sql`…` `` from `@afbin/apollo`: the table is the `data-af-name`. |
| Resolver | `<link rel="af-resolver" data-af-name="tracker" href="./tracker.ts">` plus `resolverSources:{"tracker":"…"}` at publication. TypeScript exports functions the page calls with `fetch('/fn/NAME')` (with optional `roles`, `secrets` and `schedule`); the server binds an immutable backend version. |
| Components | Import hosted `@afbin/…` modules; use their native custom elements, including data tables and isometric figures. Use direct hosted libraries for new diagrams and maps; retained Mermaid and deck.gl wrappers load through their hosted component URLs. |
| Charts | Import `@afbin/vega` and, for Vega-Lite, `@afbin/vega-lite`. Author the spec in page code; use the AST expression interpreter under the no-eval policy. |
| Files | Ordinary `<img>`, `<a>`, `<video>` and other HTML URLs; admitted `ref:ID` assets resolve through the platform. See [file uploads](file-uploads.md). |
| Design | Native styles and the platform's hosted design-system stylesheet; a saved design-system selection controls reader presentation. |

A page's namespace is not a grant: backend authorization and each dataset's
current read/write policy are checked independently. Keep credentials out of HTML
and backend source. Owner-configured backend secret bindings use the separate
permission-checked secret API; source and downloads contain no secret values.

## Comments, presence and downloads

Comments use canonical `data-af-id` anchors and revision strings, never compiler
node graphs. Dynamic targets also name their saved `ancestorId`. Optional saved
comment views explicitly select fields in the state block using
`data-af-comment-version` and JSON `data-af-comment-fields`; private drafts and
backend namespaces must stay out. Restoration changes only those fields and
never replays backend mutations. Pages without declarations retain target-only
comments. See the served `/llms/html-operations` and `/llms/runtime` guides.

The state block holds the page's defaults. A viewer's browser keeps only that viewer's
overrides (top-level keys that differed from the defaults when written), merged over the
current defaults one level deep, so a republished default reaches every key a viewer never
changed. An override whose JSON type no longer matches its default's is dropped (a `null`
default takes any value). `data-af-state-version` (1-64 letters, digits, `.`, `_`, `-`) on the
state block clears every viewer's overrides once when it changes (on that version's first
write: reading never changes saved state); publish warns about an invalid value, which is ignored.

Overrides are stored under their own browser key (`af:viewer:v2:<page>`). A viewer's state saved
by an earlier runtime (a full document under `af:viewer:<page>`) migrates on first read and is
persisted by the first write; that legacy key is never changed, so a tab left open from before the
deploy keeps working on it. Transiently, that old tab's edits after the migration are not seen by
new tabs (nor theirs by it) until it reloads. Each saved entry records the page revision that wrote
it: a tab still showing an older revision of the page never writes over it — its changes are
refused (`state.setState` reports the error and shows the saved state again; `updateQuery`
rejects) until it reloads.

Hosted readers retain sharing, comments, live source updates and presence through
the trusted reader shell. `/a/ID/download` returns portable HTML with canonical
source and runtime assets. Viewer-local state works offline; remote shared writes
are unavailable and never queue for replay. Linked public reads can connect through
the trusted local broker. Portable raster `ref:` images are packed only after
access checks; external URLs, CSS images and `srcset` are not automatically packed.
See [serving and security](serving-and-security.md) for isolation and limits, and
[HTTP API](http-api.md) for conditional saves and history.
