---
name: markup-svg
description: >-
  The inline SVG subset for motifs and small diagrams. Read only when drawing SVG.
order: 4
---
## Read first

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
