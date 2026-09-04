# One document format

An agent sends `markup` — there is no second document tier:

| In a document | What it is |
|---|---|
| Components | The kit — `<Card>`, `<Slide>`, `<Question>`, `<Grid>`, … + Tailwind classes |
| HTML | Ordinary tags for everything else, prose included (`<h1>`, `<p>`, `<table>`, inline SVG) |
| `<Helmet>` | At most one per document: `<title>`, one `<style>`, one `<script>`, `<meta name content>` |
| Files | `<img src>` and `<Video poster>` take an upload (`ref:<id>`) or any `https` URL; `<File src>` links a PDF as a card |

A document is SERVED as its own page at `/a/<id>/raw` — server-rendered,
hydrated by an in-frame runtime, and displayed in a sandboxed iframe with an
opaque origin. That is what makes an author `<script>` safe: it can paint and
respond, but it cannot reach the app's session, its storage, or the network.

Documents get: six dual-palette **themes** (`modernist · organic · industry ·
terminal · manuscript · pop`, each with a light and a dark mode), a stable public link that survives edits, and full
version history, and four **templates** (`editorial`, `deck` with a birds-eye
rail and keyboard paging, `scrolly`, `dashboard`), plus **interactive Vega
charts** — real tooltips and hover, themed to the story, rendered by a
runtime served from this origin (the CSP still blocks all external hosts,
and expression evaluation uses the AST interpreter, never `eval`). The full
component reference lives at `GET /docs/artifactbin/references/markup.md`.
