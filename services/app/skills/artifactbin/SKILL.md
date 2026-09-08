---
name: artifactbin
description: >-
  Publish and edit artifacts: markup, data and HTTP API.
read_first_max: 8192
---
## Read first — everything a straightforward document needs

**Publish before you read** — FIRST create a SKELETON: real title, theme,
template and stubbed section headings. Share its `[[ base ]]/a/<id>` URL immediately,
labelled as still filling in. Then read the references and fill sections using
targeted `edit_artifact` calls. Edits reach open readers live.

[[ publishExample ]]

Writes return `markup_changed` and canonical markup when formatting changed;
edit against that source. A 400 names the fix. Always set `title`: browser tabs
and link previews use it, not the on-page heading.

[[ authRule ]]

**Editing** — [[ readBackCall ]] returns `markup` and `edit_id`. Send the exact
change, not the whole file:

[[ editExample ]]

`old_string` must appear EXACTLY ONCE; preserve concurrent human edits.

**markup** is JSX data, not Markdown: HTML prose and inline SVG, plus kit
components (`Card`, `Tabs`, `Grid`, `SlideDeck`, `Icon`) and data embeds
(`Question`, `DataTable`, `Number`). Style parent elements with Tailwind
`className`; inline `style=` is rejected.

**Guess rather than look up.** An unknown HTML tag is refused with a 400
carrying the allowed set (`allowed_html_tags`), an unknown component the
registry: a wrong guess costs one round trip. One exception:
`[[ refusedTags | join(' ') ]]` are refused with NO list — never guess them
(`<form>` and raw `<iframe>` most often). Parent CSS and declarations live
in ONE `<Helmet>`, which also holds `<title>`:

```jsx
<Helmet><title>What the tab shows</title><style>{`:root { --primary: #ff6a1f }`}</style></Helmet>
```

**A document is a CONTAINER, and a reader may be on a phone (390px).** Use
container prefixes — `@2xl:`, `@3xl:` — never the viewport ones
(`sm:`/`md:`/`lg:` do not apply). Multi-column layouts start at
one column and widen: `grid-cols-1 @2xl:grid-cols-3`, and so does display
type — `text-4xl @2xl:text-6xl`, never a bare `text-6xl` (60px type breaks a
phone). Never a fixed pixel width.

Parent markup is self-contained: no CDN scripts or external stylesheets.
For custom DOM/canvas/JS, use managed `<Iframe>` ([markup-iframe](references/markup-iframe.md));
its declared bundled script URLs and runtime fetches use cached assets.
One legacy Helmet script runs in a hidden isolated realm, not the parent DOM.
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

**The reading path — the skeleton is published; before writing its content, read
in order:** `references/design.md` (craft), `references/markup.md` (vocabulary),
then the `references/templates-<name>.md` and `references/themes-<name>.md` you
picked — their frame is what makes it come out right (a deck without it ships
text flush to the viewport edge).

[[ checkWork ]]

**Prose and a one-dataset chart are fully covered above**. Each ask has ONE file under
`references/` ([[ docsIndexHint ]]):
| when the ask involves | read |
|---|---|
| API — replace, `expectedVersion`, visibility, folders, trash/restore, errors | `publishing.md` |
| tokens — expiry, saved config, claiming, a 401 | `publishing-auth.md` |
| Postgres connections, multi-table datasets, SQL models | `databases.md` |
| upload CSV/sheets, images, PDFs (`<File>`), viz recipes | `publishing-datasets.md` |
| pinned human feedback — reply, resolve, the anchor attribute | `publishing-annotations.md` |
| connecting an MCP client — OAuth or bearer, the tool list | `publishing-mcp.md` |
| history — versions, revert, the trash, export options | `publishing-versions.md` |
| design craft — hierarchy, type, spacing, color, motifs | `design.md` |
| tag/component allowlists, `<Helmet>`, layout | `markup.md` |
| charts (vega specs), controls, `<Mutation>`, data formats | `markup-data.md` |
| conditions, Dialog and local SQL state | `markup-state.md` |
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
