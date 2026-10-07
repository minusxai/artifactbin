---
name: markup
description: >-
  Explains JSX markup.
---
## Start

`markup` is **static JSX data**. Scripts add behaviour.

<!--bundle:skip-->
Invalid JSX returns `400 {"error":"invalid_jsx","details":[…]}` with exact spans.

<!--/bundle:skip-->
- **Static JSX only**: literal props (strings, numbers, booleans, arrays,
  `{{…}}` objects), plus safe signal conditions; no arbitrary expressions,
  spreads or inline handlers (`onClick=`). Attach handlers in a Helmet script
  with `addEventListener`. In
  JSX, every tag closes (`<br />`); use `{/* … */}` comments; omit
  `<html>`/`<head>`/`<body>`.
- **Style with Tailwind classes via `className`**, starting from a
  `<div data-design="tw" className="@container …">` wrapper with `@2xl:`
  container variants for responsive layout.
- [[ nativeTableAuthoringRule ]]
- Data (`<Import>`, `<Value>`, `<Query>`, `<Mutation>`, embeds, controls): [data](markup-data.md).
  Editable dataset cells: [editing](markup-editing.md).
  <!--bundle:skip-->[maps](markup-maps.md) · <!--/bundle:skip-->[motion](markup-motion.md) · [svg](markup-svg.md).

<!--bundle:skip-->
## Contents

Skeleton · Vocabulary · Helmet · Images · Layout.

<!--/bundle:skip-->
<!--bundle:skip-->
## Skeleton (editorial)

```jsx
<Helmet><Import name="s" src="ref:abc123" /><Query name="monthly">{`select month, sum(revenue) revenue from s.rows group by 1 order by 1`}</Query></Helmet>
<div data-design="tw" className="@container px-6 py-12 @2xl:px-12 @2xl:py-16">
  <header className="max-w-4xl">
    <p className="animate-fade-in text-xs uppercase tracking-widest text-muted-foreground">Eyebrow</p>
    <h1 className="animate-fade-up mt-4 text-5xl @2xl:text-7xl font-bold tracking-tight leading-[1.05]">The headline states the finding</h1>
    <p className="animate-fade-up [animation-delay:200ms] mt-6 text-lg text-muted-foreground max-w-prose">The standfirst earns the scroll.</p>
  </header>
  <section className="py-16">
    <h2 className="reveal-up text-2xl font-semibold tracking-tight">01 · A claim, not a topic</h2>
    <div className="reveal-up mt-6"><Question title="Revenue by month" data="$monthly" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" /></div>
  </section>
</div>
```
<!--/bundle:skip-->

## Component vocabulary (the complete allowlist)

Kit components ([[ components | length ]]):
`[[ components | join(' ') ]]`

Plus embeds `Question` `Number` and Helmet's `Import` `Value` `Query`
`Mutation` `Notify` `Context`. Unknown names are rejected with the registry;
unknown props are ignored. Bindings and Column contracts are checked at publish.

[Conditions and dialogs](markup-state.md).

[Accordion FAQ](markup-components.md).

**HTML tags** — [[ tags | length ]] are allowed: prose, headings, lists, tables,
links, media, themed `input` `select` `textarea` `button`, SVG. Unlisted tags
return `400` with `allowed_html_tags`; these are refused without a list:
[% for t in refusedTags %]`[[ t ]]` [% endfor %].

## `<Helmet>` — the document's own head

At most ONE per document: a `<Helmet>` holds one each of `<title>`, `<style>`
and `<script>`; any number of metas and data declarations (`<Import>`, etc.;
[data](markup-data.md)). It may appear anywhere; it is hoisted.

`<Context src="ref:<documentId>" />` links a Doc ([context](templates-doc.md#context)).

```jsx
<Helmet>
  <title>Quarterly review</title>
  <style>{`.rise { animation: rise .9s both } @keyframes rise { from { opacity: 0 } }`}</style>
</Helmet>
```

The `<script>` module uses Solid, npm libraries and exported components
([scripts](markup-scripts.md)); use exactly one template-literal child:
``<script>{`…`}</script>``.

- **Custom CSS lives in that `<style>` block**; an inline `style={{…}}` is fine
  for a one-off. Scope rules to your own class names (bare element selectors
  leak into chart chrome); colors from theme tokens (`var(--primary)`).
  **Utilities compile `!important`** — never fight a Tailwind class from a
  style block. CSS is unconstrained: `position: fixed`/`sticky`, `vh` (the
  real viewport), `@import url(…)`, `url()` and `@font-face` all work.
  There is no `<link>` and no body `<style>`.
- **Override a theme** in that block under `:root` — no theme-name selector
  or `!important`: `:root { --background: #0c0d0e; --primary: #ff6a1f; --chart-1: #ec6100; --font-display: Georgia, serif; }`.<!--bundle:skip-->
  Keys: `--background --foreground --card --popover --primary --secondary
  --muted --accent --destructive` (each with `-foreground`), `--border
  --input --ring --radius --chart-1..5`, `--font-body --font-display --font-mono`.<!--/bundle:skip-->
<!--bundle:skip-->
- **Web fonts**: `<meta name="font-display" content="Lobster" />` (also
  `font-body`, `font-mono`) names a Google family; the page imports it from
  Google Fonts for you. Or write that
  `@import url(https://fonts.googleapis.com/css2?family=…)` at the top of
  the style block. An `@font-face` `url(https://…)` in your `<style>` is
  imported the same way as an image.
- **Other hosts**: `<meta name="csp-connect" content="https://api.x.com" />`, also
  `csp-script|style|img|media|frame`; readers are asked — [scripts](markup-scripts.md).
<!--/bundle:skip-->
- **Theme tokens first**: `text-muted-foreground`, `bg-muted`, `border-border`,
  `bg-background` follow the theme. One custom accent (`text-[#e2483d]`) is
  allowed; it stays fixed when the theme changes.
- `theme`, `template` and `colorMode` are top-level fields of the YAML fence
  atop the file you push, not Helmet content. No page type named → pick
  it from the content's shape ([templates.md](templates.md)); torn → ask the user. `colorMode`
  (`light | dark`) is the AUTHOR'S DEFAULT — readers flip it, so design in theme tokens.

<!--bundle:skip-->
Social preview: `<Helmet>` metas `artifactbin:og-image` and
`artifactbin:og-image-crop` — [export](publishing-versions.md).

<!--/bundle:skip-->
## Images and icons

Galleries: [image bindings](markup-repeat.md).

- `<img src="ref:<imageId>" />` — an [uploaded image](publishing-datasets.md).
  Web URLs also work and are served as written.
- In parent markup only `<img src>` and `<File src>` take a URL;
  `srcSet`/`background` reject an external one. `href` is free.
- `<iframe src="https://…" title="…" />` frames an [embed URL](markup-embeds.md);
  popular providers by default, others need `csp-frame`.
<!--bundle:skip-->
- An image `src` also binds: `"$pick"`, or `"https://…/{$pick}.png"` to
  compose one — the only braced position; the first reader imports it.
<!--/bundle:skip-->
- `<Icon name="chart-bar" />` — a lucide icon, inline (kebab-case names from
  lucide.dev). Size it with a `size-*` class; it inherits `currentColor`.

<!--bundle:skip-->
## Layout components

`<SlideDeck><Slide title="…">…</Slide></SlideDeck>` — a presentation, each
slide filling the viewport (`deck`). `<Grid><GridItem x={0} y={0} w={6}
h={3}>…</GridItem></Grid>` — the 12-column canvas (`dashboard`).

Flow columns: [Grid](templates.md).

<!--/bundle:skip-->
<!--bundle:skip-->
## Do / Don't

- DO cap body copy at `max-w-prose`; let CHARTS break wider.
- Three or more `<h2>` sections get a table of contents made from the
  headings — write `<h2>`s as short claims. Decks and `<Grid>` dashboards get none.

<!--/bundle:skip-->
[Scripts, components and libraries (Three.js)](markup-scripts.md).
