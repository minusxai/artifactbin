---
name: explainers
description: Mechanism-led explanatory figures for articles, reports and technical stories, with the built-in Isometric figure and custom SVG.
---
## Read first

Use a crafted figure when seeing a mechanism would explain the central idea.
Choose a real object or an explicitly labelled analogy whose behaviour maps
to the concept: a wind-tunnel balance for lift, a sliding gauge for measurement,
or a reservoir for a rate limiter. A flowchart or wireframe remains a better
choice when sequence or interface layout is the subject.

## Contents

- [Design the explanation](#design-the-explanation)
- [State is the page's signals](#state-is-the-pages-signals)
- [Built-in isometric figures](#built-in-isometric-figures)
- [Custom mechanisms](#custom-mechanisms)
- [Make it usable](#make-it-usable)

## Design the explanation

- Write what the reader changes, what moves and what that change teaches.
  Keep controls, motion and numerical readouts driven by the same model.
  Separate measured facts, computed values and illustrative behaviour.
- Give the object coherent construction: supports, joints, visible thickness,
  connected parts and consistent perspective. Detail should explain assembly
  or operation; an arbitrary part count does not establish quality.
- Use one focal mechanism with a readable silhouette at phone size. Put prose
  and a finding-led caption outside the drawing. Identify controls and units.
- The selected design system still owns the page. Derive drawing tones and
  highlights from its tokens; an isometric figure is an optional drawing
  treatment, not a second page theme.

## State is the page's signals

Declare reader-controlled parameters and time in `<Value>`. Bind Kit controls
with `value="$angle"`; read or update the same state in the author script with
`signal('$angle')` from `page`. Derive geometry and numerical readouts from
those signals. Keep drag-hover bookkeeping local; do not create a second store
for parameters already declared on the page.

```jsx
<Helmet>
  <Value name="angle" type="number" default={30} />
  <script>{`
    import { signal } from 'page';
    import { createEffect } from 'solid-js';
    const [angle] = signal('$angle');
    createEffect(() => {
      const radians = angle() * Math.PI / 180;
      const vector = document.getElementById('direction-vector');
      vector.setAttribute('x2', String(50 + 90 * Math.cos(radians)));
      vector.setAttribute('y2', String(110 - 90 * Math.sin(radians)));
      document.getElementById('direction-readout').textContent = angle() + '°';
    });
  `}</script>
</Helmet>
<figure>
  <svg viewBox="0 0 180 140" role="img" aria-label="Direction measured from the horizontal">
    <path d="M50 20V110H150" fill="none" stroke="var(--muted-foreground)" />
    <line id="direction-vector" x1="50" y1="110" x2="127.94" y2="65" stroke="var(--primary)" strokeWidth="3" />
  </svg>
  <Slider label="Direction in degrees" value="$angle" min={0} max={90} step={1} />
  <figcaption>FIG. 01 — The vector turns through <span id="direction-readout">30°</span>.</figcaption>
</figure>
```

For an exported Solid component, reactive JSX reads the signals or its bound
props. Canvas/WebGL redraw in `createEffect` from the same signals. A playback
loop advances a time Value; a scrubber sets that same Value. Integrate a
simulation separately only when its equations require accumulated state;
keep its controls bound to the page. Stop loops on cleanup and offscreen.

Choose rendering by the explanation: SVG for geometric transformations and
labelled diagrams, Canvas for many moving marks, WebGL for spatial models,
and `Isometric` for projected assemblies. These share state and controls,
not a universal scene format. Follow [scripts](markup-scripts.md) for lifecycle
and [motion](markup-motion.md) for playback and reduced motion.

## Built-in isometric figures

Use `<Isometric>` for assemblies made from slabs, cylinders, extruded outlines
and lines. It provides projection, visible faces, shading and responsive SVG,
in the selected design system's colours. Static figures render without a
client module; a bound separation control makes the same drawing interactive.
No library download, external import or installation is needed.

```jsx
<Helmet><Value name="spread" type="number" default={0} /></Helmet>
<figure>
  <Isometric title="A shaft seated in a bearing on a base plate" spread="$spread"
    parts={[
      {"key":"base","kind":"slab","x":-60,"y":-40,"z":0,"width":120,"depth":80,"height":8,"radius":5},
      {"key":"bearing","kind":"cylinder","x":0,"y":0,"z":8,"radius":20,"height":12,"tone":"muted","separation":[0,0,20]},
      {"key":"shaft","kind":"cylinder","x":0,"y":0,"z":20,"radius":7,"height":55,"tone":"accent","separation":[0,0,55]}
    ]} />
  <Slider label="Separate the assembly" value="$spread" min={0} max={1} step={0.01} />
  <figcaption>FIG. 01 — The bearing supports the shaft above the base plate.</figcaption>
</figure>
```

Coordinates share one unit: x/y are the ground plane; z points up. Draw parts
back to front in array order; this is a projected assembly, not a general
3D occlusion engine. Give each part a unique `key`:

| kind | Geometry |
| --- | --- |
| `slab` | `x`, `y`, `z`, `width`, `depth`, `height`; optional corner `radius` |
| `cylinder` | centre `x`, `y`, bottom `z`, `radius`, `height` |
| `prism` | simple non-self-intersecting `points: [ [x,y], … ]`, bottom `z`, `height` |
| `line` | `points: [ [x,y,z], … ]`; optional `dashed: true` |

Optional `tone`: `neutral` (default), `accent`, `secondary` or `muted`.
Optional `separation: [dx,dy,dz]` is that part's full displacement at
`spread={1}`. `spread={0}` is assembled; `spread="$name"` reads a numeric
Value shared with a Slider or other control. The camera fits both end states
so moving the control does not zoom the scene. Parts are static JSON, up to
300 parts and 256 points per outline or line. Keep outlines simple and verify
overlap at both extremes; separation explains assembly, not simulated physics.

The figure defaults to a 640×400 coordinate frame, azimuth 45° and elevation
30°. Set `width`, `height`, `azimuth` (0–360°), `elevation` (5–85°) to compose it;
the SVG scales to its container. Put labels, prose, controls and captions
outside the drawing. A title provides its accessible name.

## Custom mechanisms

Use inline SVG and the existing [Helmet script](markup-scripts.md) when the
subject needs deformation, rotating airfoils, curved pipes, bespoke labels or
a different projection. Keep the meaningful initial pose in markup, CSS in
Helmet style, and behaviour in script. Compute the static geometry during
authoring; include only the geometry functions needed for moving parts.
Follow the supported [SVG subset](markup-svg.md). The built-in figure is an
option, not a requirement to force every subject into an exploded assembly.

## Make it usable

Give each interaction a visible control usable by keyboard and touch;
hover can enhance it. Start with a meaningful static pose that survives
exports and unavailable scripts. Follow [motion guidance](markup-motion.md):
respect reduced motion, pause continuous work offscreen, and keep prose still.

Check the published artifact at desktop and phone widths, at control
extremes, and in both colour modes. Inspect joints, layering and labels at
close range. Verify that readouts and moving parts agree, and that a reader
can understand the explanation without operating the control.
