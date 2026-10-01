# One document format

An agent sends `markup` — there is no second document tier:

| In a document | What it is |
|---|---|
| Components | The kit — `<Card>`, `<Slide>`, `<Question>`, `<Grid>`, … + Tailwind classes |
| HTML | Ordinary tags for everything else, prose included (`<h1>`, `<p>`, `<table>`, inline SVG) |
| `<Helmet>` | At most one per document: `<title>`, one `<style>`, one `<script>`, `<meta name content>`, and the data |
| Data | In `<Helmet>`: `<Import>` a dataset, `<Value>` page values, `<Query>` in SQLite, `<Mutation>` writes. The body binds them by name: `data="$q"`, `value="$v"`, `run="$m"`, `set={{…}}` |
| Files | `<img src>` and `<Video poster>` take an upload (`ref:<id>`) or any `https` URL; `<File src>` links a PDF as a card |

A document is SERVED as compiled static HTML with small Solid islands: `/a/<id>` with the app's reader
chrome, `/a/<id>/raw` without it (see [Phase 2 architecture](phase2-architecture.md)). An author
`<script>` runs in a separate opaque-origin frame, so it can paint and respond but cannot reach the
app's session, its storage, or the network.

Documents get: six dual-palette **themes** (`modernist · organic · industry ·
terminal · manuscript · pop`, each with a light and a dark mode), a stable public link that survives edits, and full
version history, and five **templates** (`editorial`, `deck` with a birds-eye
rail and keyboard paging, `scrolly`, `dashboard`, `plan`), plus **interactive Vega
charts** — real tooltips and hover, themed to the story, rendered by a
runtime served from this origin (the CSP still blocks all external hosts,
and expression evaluation uses the AST interpreter, never `eval`). The full
component reference is bundled locally: `afbin help markup`.

The owner/editor “social preview” control stores its locked 40:21 framing as
`<meta name="artifactbin:og-crop" content="x=…;y=…;width=…" />` in `<Helmet>`.
Coordinates use the document's canonical 1600px-wide layout; crop height is
derived from width, and removing the meta restores the top-left default.
