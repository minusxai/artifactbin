---
name: artifact-bin
description: >-
  Publish documents to artifact-bin over HTTP and share the link. Read first, always: everything a straightforward document needs. Use when asked to publish, share or host a page, report, dashboard, deck, dataset, chart or image.
read_first_max: 8192
---
## Read first — everything a straightforward document needs

Publish with one call — the response carries the `id` and the `url` to hand over:

[[ publishExample ]]

Every write answers `markup_changed`: true = storing rewrote it (formatting,
a hoisted `<Helmet>`, a `<p>` holding a block) and the canonical `markup`
rides back — edit against that. A 400 names exactly what to fix. The deliverable is `[[ base ]]/a/<id>`.
**`title` is what a browser tab and link previews show** — always set it; the
on-page heading is not it.

[[ authRule ]]

**Editing a published document** — send the CHANGE, not the whole file. [[ readBackCall ]] returns the current `markup` and an
`edit_id`; pass that `edit_id` back with the exact text to swap:

[[ editExample ]]

`old_string` must appear EXACTLY ONCE. Prefer it over replacing the whole
document: smaller, and a human may be editing the same page live.

**markup** is JSX treated as data: ordinary HTML tags for everything including
prose (`h1 h2 p ul li blockquote table figure img`, inline `svg`) plus the
component kit (`Card`, `Tabs`, `Badge`, `Grid`/`GridItem`,
`SlideDeck`/`Slide`, `Icon`, and the data embeds `Question`,
`DataTable`, `Number`), styled ONLY with Tailwind utilities via
`className` — inline `style=` is rejected. There is no markdown.

**Guess rather than look up.** An unknown HTML tag is refused with a 400
carrying the whole allowed set (`allowed_html_tags`), an unknown component the
registry — a wrong guess costs one cheap round trip. One exception:
`[[ refusedTags | join(', ') ]]` are refused outright with NO list — never guess
them (`<form>`, `<iframe>`, `<meta>` are the common mistakes). Custom CSS
and JS live in ONE `<Helmet>`, which also holds `<title>`:

```jsx
<Helmet><title>What the tab shows</title><style>{`:root { --primary: #ff6a1f }`}</style></Helmet>
```

**A document is a CONTAINER, and a reader may be on a phone (390px).** Use
container prefixes — `@2xl:`, `@3xl:` — never the viewport ones
(`sm:`/`md:`/`lg:` do not apply). Multi-column layouts start at
one column and widen: `grid-cols-1 @2xl:grid-cols-3`, and so does display
type — `text-4xl @2xl:text-6xl`, never a bare `text-6xl` (60px type breaks a
phone). Never a fixed pixel width.

Rules a document lives by: one self-contained document — no CDN `<script src>`,
no external stylesheet (hard 400s at publish); a runtime `fetch()` elsewhere
is blocked by the sandbox; images are a `data:` URI or
an `https://` URL (imported at publish); web fonts: a Google family via
`<meta name="font-display" content="Lobster" />`.

**Data in a document** — three moves: upload the rows, declare a `<Query>` over
them inside the `<Helmet>`, bind an embed by `$name`. The rows are their own
artifact (`{"dataset":"month,revenue\n2026-01,120"}`); its create response
echoes a ready-to-paste Query+Question.

```jsx
<Helmet><Query name="sales">{`select region, sum(revenue) revenue from ref_<datasetId> group by 1`}</Query></Helmet>
<Question data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} />
```

`<DataTable data="$sales" />` tables the same rows; a reader control
(`<Select value="$region" options="$regions" />`) writes into a `<Value>` and
re-runs its queries live. **For ANY dataviz — charts, KPIs, tables, controls —
read `references/markup-data.md` first, and ALWAYS chart with these embeds,
never a hand-rolled `<svg>` chart**: `<Question viz>` speaks full vega-lite,
and the kit adds theme palettes, tooltips, responsive sizing and live re-runs
for free.

**theme** — the palette and fonts; author with token classes
(`bg-background`, `text-muted-foreground`) and it follows:

[% for t in themes %]
- `[[ t.name ]]` — [[ t.short ]]
[% endfor %]

`colorMode`: `light` | `dark`.

**template** — the structural genre. Pick by the ask; deviating deliberately
is first-class:

- `deck` — slides for PRESENTING: one idea per slide, ~40% empty space.
- `dashboard` — an operating view: `<Grid>` tiles wall to wall, KPI numbers as
  the only big type, almost no prose.
- `editorial` — a report or long read: ONE centered `max-w-2xl` column,
  numbered `<h2>` section claims. For artifacts with lots of text.
- `scrolly` — data stories (pudding-style) and fun use cases: one conceit the
  whole page commits to, chapter bands, evidence revealed on scroll. The
  strongest default when none of the above fit.

**The reading path — before writing, read in order:**
`references/design.md` (the craft), `references/markup.md` (the full
vocabulary), then as needed the `references/templates-<name>.md` and
`references/themes-<name>.md` you picked — the frame and skeleton there are
what make it come out right (a deck without its frame ships text flush to the
viewport edge). Other references as needed — data/dataviz adds
`references/markup-data.md`, annotations/comments
`references/publishing-annotations.md`.

[[ checkWork ]]

**Prose, sections and a one-dataset chart are fully covered above** — for a
quick job this sheet is the whole thing; anything more follows the reading
path. Beyond both, each ask has ONE file under `references/` ([[ docsIndexHint ]]):
| when the ask involves | read |
|---|---|
| the API in full — full replace, `expectedVersion`, visibility & sharing, the error table | `publishing.md` |
| tokens — expiry, `/tokens/new`, saved config, claiming, a 401 | `publishing-auth.md` |
| uploading data — CSV/sheet/URL rows, images, viz recipes, refresh warnings | `publishing-datasets.md` |
| pinned human feedback — reply, resolve, the anchor attribute | `publishing-annotations.md` |
| connecting an MCP client — OAuth or bearer, the tool list | `publishing-mcp.md` |
| history — versions, revert, delete, export options | `publishing-versions.md` |
| design craft — hierarchy, type, spacing, color, motifs | `design.md` |
| the complete tag + component allowlists, `<Helmet>` in depth, layout rules | `markup.md` |
| dataviz & charts (vega specs), controls, writable datasets, `<Mutation>`, formats | `markup-data.md` |
| scroll reveals and ambient motion classes | `markup-motion.md` |
| video embeds — the click-to-open card | `markup-video.md` |
| inline SVG motifs and the allowed subset | `markup-svg.md` |
| a long/intricate genre piece — act structure, full skeleton | `templates-<name>.md` (index: `templates.md`) |
| the picked theme — tokens, accent class, chart palette | `themes-<name>.md` (index: `themes.md`) |
[[ docsMoreLine ]]
