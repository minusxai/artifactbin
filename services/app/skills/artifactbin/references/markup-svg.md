---
name: markup-svg
description: >-
  Mermaid diagrams and the inline SVG drawing subset.
order: 4
---
## Read first

For flowcharts, state machines and sequence diagrams, prefer the first-class
`<Mermaid>` component. It handles layout, the document theme and exports;
its static `code` string stays editable through ordinary document edits.

```jsx
<Mermaid title="Shift workflow" code={`flowchart TD
  A[Draft shift] -->|Assign| B{Conflict?}
  B -->|No| C[Saved]
  B -->|Yes| D[Resolve conflict]
  D -->|Retry| B
`} />
```

Use `stateDiagram-v2` or `sequenceDiagram` for those diagram types. Code is
limited to 20,000 characters; diagram configuration/frontmatter is refused.
The app owns strict rendering, theme and resource limits; click callbacks
are disabled. Syntax errors show a readable error and keep the source; in edit
mode, select a diagram to change its source and title in the inspector.
The theme paints node kinds apart: steps `[text]` sit on the muted surface,
decisions `{text}` take the accent outline, rounded `(text)` and circle
`((text))` nodes take the accent tint — so mark start/end nodes rounded.
Do not draw UI wireframes in Mermaid: use spatial HTML/CSS screen panels.

## Inline SVG

A minimal drawing subset renders inline for motifs and small diagrams — a
frame ruler, a route map, a sparkline decoration:

`<svg viewBox="0 0 640 48" className="w-full">` with
`g path line polyline polygon rect circle ellipse text tspan defs
linearGradient radialGradient stop clipPath title desc` (canonical camelCase
for `clipPath`/`linearGradient`/`radialGradient`). Use `currentColor` and
token-driven classes so the drawing follows the theme; gradients and clips
must reference LOCAL ids only (`fill="url(#g)"` — external `url(…)` targets
are rejected). No `use`/`image`/`foreignObject`/SMIL.

An `<svg>` keeps its OWN `<title>` — the graphic's accessibility label, a
different element from the document title in `<Helmet>`; one per icon is fine.

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
