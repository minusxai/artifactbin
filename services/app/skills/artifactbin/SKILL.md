---
name: artifactbin
description: >-
  Publish and edit artifacts: markup, data and HTTP API.
read_first_max: 8192
---
## Read first — everything a straightforward document needs

**Use the supplied document ID.** Read and edit it; never create a replacement
to recover from an error. With no supplied document, create a titled skeleton,
then fill it. Datasets are separate. Follow the user's URL-sharing instructions.

Use `mktemp -d` for scratch files; change its parent on permission errors.
No SDK or CLI is needed.

For a NEW document only:

[[ publishExample ]]

Writes return `markup_changed` and canonical markup when formatting changed;
edit against that source. A 400 names the fix. Set `title` for browser tabs and link previews.

[[ authRule ]]

**Editing** — [[ readBackCall ]] returns `markup` and `edit_id`. Send the exact
change, not the whole file:

[[ editExample ]]

`old_string` must match stored markup EXACTLY ONCE. Rejected writes changed
nothing. After `bad_diff`, read again; never match against a rejected proposal.

**markup** is JSX data, not Markdown: HTML prose and inline SVG, plus kit
components (`Card`, `Tabs`, `Grid`, `SlideDeck`, `Icon`) and data embeds
(`Question`, `DataTable`, `Number`). Style parent elements with Tailwind
`className`; inline `style=` is rejected.

**Prefer native JSX** and kit controls, conditions and Dialog for themes, layout,
comments and editing. Reserve `<Iframe>` for isolated DOM-script/canvas widgets
the kit cannot provide; never frame a document merely for unrestricted HTML/CSS/JS.

**HTML/component names only: guess rather than look up.** Unknown tags return
400 with `allowed_html_tags`; unknown components return the registry. Exception:
`[[ refusedTags | join(' ') ]]` are refused with NO list — never guess them
(`<form>` and raw `<iframe>` most often). Parent CSS and declarations live
in ONE `<Helmet>`, which also holds `<title>`:

```jsx
<Helmet><title>What the tab shows</title><style>{`:root { --primary: #ff6a1f }`}</style></Helmet>
```

**Design for a 390px CONTAINER.** Use `@2xl:`, `@3xl:`, not viewport
`sm:`/`md:`/`lg:`. Start with `grid-cols-1 @2xl:grid-cols-3` and
`text-4xl @2xl:text-6xl`; no fixed pixel widths or bare `text-6xl`.

Parent markup is self-contained: no CDN scripts or external stylesheets.
For those widgets, read [markup-iframe](references/markup-iframe.md): bundled
scripts and fetches use cached assets. A legacy Helmet script runs in a hidden
realm without parent DOM access.
Parent images are a `data:` URI or
any `https://` URL (publish copies it, your URL stays); web fonts: a Google family via
`<meta name="font-display" content="Lobster" />`.

**Data in a document** — three moves: upload the rows, declare a `<Query>` over
them in the `<Helmet>`, bind an embed by `$name`. The rows are their own
artifact (`{"dataset":"month,revenue\n2026-01,120"}`); `source` selects its ID; SQL names a table (`public.rows` for flat uploads).

```jsx
<Helmet><Query name="sales" source="<datasetId>">{`select region, sum(revenue) revenue from public.rows group by 1`}</Query></Helmet>
<Question data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} />
```

`<DataTable data="$sales" />` tables the same rows; a
`<Select value="$region" options="$regions" />` writes into a `<Value>` and
re-runs its queries live. **For ANY dataviz — charts, KPIs, tables, controls —
read `references/markup-data.md` first, and ALWAYS chart with these embeds,
never a hand-rolled `<svg>` chart**: `<Question viz>` speaks full vega-lite,
the kit adds theme palettes, tooltips, responsive sizing and live re-runs.

**theme** — the palette and fonts; author with token classes
(`bg-background`, `text-muted-foreground`) and it follows:

[% for t in themes %]
- `[[ t.name ]]` — [[ t.short ]]
[% endfor %]

`colorMode`: `light` | `dark`.

**template** — the genre. Pick by the ask; deviating deliberately is
first-class:

- `deck` — slides for PRESENTING: one idea per slide, ~40% empty space.
- `dashboard` — an operating view: `<Grid>` tiles wall to wall, KPI numbers as
  the only big type, almost no prose.
- `editorial` — a report or long read: ONE centered `max-w-2xl` column,
  numbered `<h2>` section claims.
- `scrolly` — data stories (pudding-style): one conceit the
  whole page commits to, chapter bands, evidence revealed on scroll. The
  strongest default when nothing above fits.

**Before writing, read in order:** `references/design.md` (craft), `references/markup.md` (vocabulary),
then `references/templates-<name>.md` and `references/themes-<name>.md`.
Skipping the template leaves a deck flush to the viewport edge.

[[ checkWork ]]

For result checks: `references/publishing-query.md`. Never guess HTTP routes;
test one request before batching.

More under `references/` ([[ docsIndexHint ]]):
| when the ask involves | read |
|---|---|
| optional query result verification | `publishing-query.md` |
| API — replace, `expectedVersion`, visibility, folders, trash/restore, errors | `publishing.md` |
| tokens — expiry, saved config, claiming, a 401 | `publishing-auth.md` |
| Postgres connections, multi-table datasets, SQL models | `databases.md` |
| upload CSV/sheets, images, PDFs (`<File>`), viz recipes | `publishing-datasets.md` |
| pinned human feedback — reply, resolve, the anchor attribute | `publishing-annotations.md` |
| connecting an MCP client — OAuth or bearer, the tool list | `publishing-mcp.md` |
| history — versions, revert, the trash, export options | `publishing-versions.md` |
| design craft — hierarchy, type, spacing, color, motifs | `design.md` |
| tag/component allowlists, `<Helmet>`, layout | `markup.md` |
| data and keyed templates | `markup-data.md`, `markup-repeat.md` |
| chart serialization and statistical meaning | `markup-data-authoring.md` |
| conditions, Dialog and local SQL state | `markup-state.md` |
| LLM mutations | `markup-generation.md` |
| isolated DOM/canvas, bundled scripts and cached assets | `markup-iframe.md` |
| script signal subscriptions and mutation bridge | `markup-scripts.md` |
| editable cells, tags and reference pickers | `markup-editing.md` |
| scroll reveals and ambient motion classes | `markup-motion.md` |
| Video embeds | `markup-video.md` |
| SVG motifs and allowed tags | `markup-svg.md` |
| Libraries, GLBs, files | `markup-libraries.md` |
| genre structure and full skeleton | `templates-<name>.md` (index: `templates.md`) |
| theme tokens, accents, chart palette | `themes-<name>.md` (index: `themes.md`) |
[[ docsMoreLine ]]
