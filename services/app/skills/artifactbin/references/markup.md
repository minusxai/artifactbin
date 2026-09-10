---
name: markup
description: >-
  Explains JSX markup.
---
## Read first

`markup` is **static JSX data**, interpreted over a fixed component registry.
Prefer native JSX and kit interactions. Reserve Iframe for isolated widgets
requiring DOM scripts or canvas APIs; keep surrounding content native.

Invalid JSX returns `400 {"error":"invalid_jsx","details":[…]}` with exact spans.

- **Static JSX only**: literal props (strings, numbers, booleans, arrays,
  `{{…}}` objects), plus safe signal conditions; no arbitrary expressions,
  spreads or inline handlers (`onClick=` is
  rejected). In JSX, every tag closes (`<br />`); use `{/* … */}` comments; omit
  `<html>`/`<head>`/`<body>`. Widget DOM scripts belong inside managed
  [Iframe](markup-iframe.md).
- **Style with Tailwind classes via `className`**, starting from a
  `<div data-design="tw" className="@container …">` wrapper with `@2xl:`
  container variants for responsive layout.
- Data (`<Query>`, `<Value>`, `<Mutation>`, embeds, controls): [data](markup-data.md).
  Editable dataset cells: [editing](markup-editing.md).
  [motion](markup-motion.md) · [video](markup-video.md) · [svg](markup-svg.md).

## Contents

Skeleton · Vocabulary · Helmet · Images · Layout.

## Skeleton (editorial)

```jsx
<Helmet><Query name="monthly">{`select month, sum(revenue) revenue from ref_<datasetId> group by 1 order by 1`}</Query></Helmet>
<div data-design="tw" className="@container px-6 py-12 @2xl:px-12 @2xl:py-16">
  <header className="max-w-4xl">
    <p className="animate-fade-in text-xs uppercase tracking-widest text-muted-foreground">Eyebrow</p>
    <h1 className="animate-fade-up mt-4 text-5xl @2xl:text-7xl font-bold tracking-tight leading-[1.05]">The headline states the finding</h1>
    <p className="animate-fade-up [animation-delay:200ms] mt-6 text-lg text-muted-foreground max-w-prose">The standfirst earns the scroll in one sentence.</p>
  </header>
  <section className="py-16">
    <h2 className="reveal-up text-2xl font-semibold tracking-tight">01 · A claim, never a topic</h2>
    <div className="reveal-up mt-6"><Question title="Revenue by month" data="$monthly" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" /></div>
  </section>
</div>
```

## Component vocabulary (the complete allowlist)

Kit components ([[ components | length ]]):
`[[ components | join(' ') ]]`

Plus the embeds `Question` `Number` and the Helmet declarations `Value`
`Query` `Mutation`; a name outside that list is rejected with the registry
echoed back. Unknown props are ignored; data bindings and Column contracts are checked
at publish.

[Conditions and dialogs](markup-state.md).

**HTML tags: write the ordinary tag you mean** — [[ tags | length ]] are allowed
(prose, headings, lists, tables, links, media, the bare controls `input`
`select` `textarea` `button`, inline SVG): an unlisted tag returns `400` with `allowed_html_tags`. Only these are refused
outright, with no list: [% for t in refusedTags %]`[[ t ]]` [% endfor %].

## `<Helmet>` — the document's own head

At most ONE per document, holding at most one each of `<title>`, `<style>`
and `<script>`, plus `<meta name content />` pairs, plus any number of the
DATA declarations `<Value>`, `<Query>`, `<Mutation>` ([data](markup-data.md)).
Write it anywhere outside Iframe; it is hoisted to the top when stored.
Parent CSS and data declarations belong here. Iframe owns its own CSS/JS.

```jsx
<Helmet>
  <title>Quarterly review</title>
  <style>{`.rise { animation: rise .9s both } @keyframes rise { from { opacity: 0 } }`}</style>
</Helmet>
```

One legacy Helmet script may run after hydration in a hidden opaque realm:
no parent DOM, cookies, storage or direct API requests. Use conditions and
Dialog for parent UI; move DOM scripts into Iframe. See [script APIs](markup-scripts.md).
`</script` cannot appear in the text (split it: `'</scr' + 'ipt'`).
Inside Iframe, attach DOM handlers with `addEventListener`. The `mx` bridge
reads/writes declared signals and runs named mutations. Subscribe to named
queries for rows that arrive after startup; see the script API reference.

- **Custom CSS lives in that `<style>` block, never inline** (`style=` is rejected).
  Scope rules to your own class names (bare element selectors leak into chart
  chrome); colors from theme tokens (`var(--primary)`).
  **Utilities compile `!important`** — never fight a Tailwind class from a
  style block. At save, `position: fixed/sticky`, `@import` and a `url()`
  outside `@font-face` are stripped; `100vh` becomes the reader viewport.
- **Override a theme** in that block under `:root` — no theme-name selector
  or `!important`: `:root { --background: #0c0d0e; --primary: #ff6a1f; --chart-1: #ec6100; --font-display: Georgia, serif; }`.
  Keys: `--background --foreground --card --popover --primary --secondary
  --muted --accent --destructive` (each with `-foreground`), `--border
  --input --ring --radius --chart-1..5`, `--font-body --font-display --font-mono`.
- **Web fonts**: `<meta name="font-display" content="Lobster" />` (also
  `font-body`, `font-mono`) names a Google family, served from this origin;
  an unknown family fails the publish. An `@font-face` `url(https://…)` in
  your `<style>` is imported the same way.
- **Theme tokens first**: `text-muted-foreground`, `bg-muted`, `border-border`,
  `bg-background` follow the active theme; hardcoded palettes fight it. ONE
  bespoke accent (`text-[#e2483d]`) is legitimate for the one bold moment —
  it will not follow a later theme switch.
- `theme`, `template` and `colorMode` are top-level fields of the publish
  call, not Helmet content. No genre named → **default to `scrolly`**; torn →
  ask the user. `colorMode`
  (`light | dark`) is the AUTHOR'S DEFAULT — readers flip it, so design in theme tokens.

Social preview: [upload and crop](publishing-versions.md).

## Images and icons

- `<img src="ref:<imageId>" />` — an uploaded image
  ([publishing-datasets.md](publishing-datasets.md)) — or write the web URL
  itself: publish stores a copy, YOUR URL STAYS as written, readers are served
  ours, and a URL that will not fetch is a warning, not a failed publish.
- In parent markup only `<img src>`, `<Video poster>` and `<File src>` take a URL;
  `srcSet`/`background` reject an external one. `href` is free.
- An image `src` also binds: `"$pick"`, or `"https://…/{$pick}.png"` to
  compose one — the only braced position; the first reader imports it.
- `<Icon name="chart-bar" />` — a lucide icon, inline (kebab-case names from
  lucide.dev). Size it with a `size-*` class; it inherits `currentColor`.

## Layout components

`<SlideDeck><Slide title="…">…</Slide></SlideDeck>` — a presentation, each
slide filling the viewport (`deck`). `<Grid><GridItem x={0} y={0} w={6}
h={3}>…</GridItem></Grid>` — the 12-column canvas (`dashboard`).

## Do / Don't

- DO cap body copy at `max-w-prose`; let CHARTS break wider. Every table is
  already its own scroll box — never widen one with negative margins.
- Three or more `<h2>` sections get a table of contents made from the
  headings — write `<h2>`s as short claims. Decks and `<Grid>` dashboards get none.

[Three.js, libraries and file references](markup-libraries.md).
