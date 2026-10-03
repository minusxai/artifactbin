---
name: markup-svg
description: >-
  Mermaid diagrams and the inline SVG drawing subset.
order: 4
---
## Read first

For flowcharts, state machines and sequence diagrams, use `<Mermaid>`: it
handles layout, theme and exports.

```jsx
<Mermaid title="Shift workflow" code={`flowchart TD
  A[Draft shift] -->|Assign| B{Conflict?}
  B -->|No| C[Saved]
  B -->|Yes| D[Resolve conflict]
  D -->|Retry| B
`} />
```

Also `stateDiagram-v2` and `sequenceDiagram`. Code is at most 20,000
characters; configuration/frontmatter is refused; click callbacks are off.
The theme paints steps `[text]` muted, decisions `{text}` with the accent
outline, rounded `(text)` and circle `((text))` nodes with the accent tint, so
mark start/end nodes rounded. UI wireframes are HTML/CSS panels, not Mermaid.

## Inline SVG

A drawing subset for motifs and small diagrams:
`<svg viewBox="0 0 640 48" className="w-full">` with
`g path line polyline polygon rect circle ellipse text tspan defs
linearGradient radialGradient stop clipPath title desc` (canonical camelCase
for `clipPath`/`linearGradient`/`radialGradient`). Use `currentColor` so the drawing follows the theme; gradients and clips
must reference LOCAL ids only (`fill="url(#g)"` — external `url(…)` targets
are rejected). No `use`/`image`/`foreignObject`/SMIL.

An `<svg>` keeps its own `<title>` (its accessible label, not the document
title).

A `<For>` inside `<svg>` repeats shapes as a `<g>` (its `className` and
`id` land there); its template takes SVG tags only. Bars from a query:

```jsx
<Helmet>
  <Value name="sales" type="table" value={[{"i":0,"n":12},{"i":1,"n":30}]} />
  <Query name="bars">{`select i, i * 12 x, 40 - n y, n h from sales`}</Query>
</Helmet>
<svg viewBox="0 0 24 40" className="w-24 text-primary">
  <For each={$bars} keyBy="i">
    <rect x="$_row.x" y="$_row.y" width="10" height="$_row.h" fill="currentColor" />
  </For>
</svg>
```
