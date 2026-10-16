---
name: explainers
description: "Mechanism-led explanatory figures using compact Isometric specs: extrusions, revolved bodies, swept pipes, assemblies, rotation and sketch linework."
---
## Read first

Choose a mechanism that explains the central idea. Write what the reader
changes, what moves, and what that change teaches.

**Author the recipe, not rendered paths.** `<Isometric>` takes static `parts`;
the kit constructs surfaces, projects contours and animates controls. Do not
paste generated SVG or another geometry engine into the document for supported
shapes. No installation or external import.

## Contents

- [Shapes](#shape-vocabulary) · [Controls](#controls-and-motion) · [Style](#clean-technical-drawing-style)

## Compose the explanation

Use one mechanism readable at phone size, with supports, joints and thickness.
Keep prose, labels and controls outside the drawing. Use the design system’s
tones. Distinguish measured facts, computed results and illustrative motion:
rotating a wing changes geometry; moving dashes do not calculate airflow or lift.

## A compact assembly

```jsx
<Helmet><Value name="spread" type="number" default={0} /></Helmet>
<figure>
  <Isometric title="A cup and curved feed pipe" appearance="outline"
    motion="smooth" spread="$spread" parts={[
      {"key":"base","kind":"slab","x":-30,"y":-30,"z":0,"width":85,"depth":60,"height":5,"radius":4},
      {"key":"vessel","kind":"group","separation":[0,0,35],"parts":[
        {"key":"cup","kind":"revolve","origin":[0,0,5],"profile":[ [0,0],[12,0],[18,32],[15,32],[10,3],[0,3] ],"tone":"accent"},
        {"key":"pipe","kind":"sweep","points":[ [38,0,8],[38,0,55],[0,0,55],[0,0,40] ],"curve":"bezier","radius":2,"tone":"secondary"}
      ]}
    ]} />
  <Slider label="Separate the assembly" value="$spread" min={0} max={1} step={0.01} />
  <figcaption>The hollow vessel and feed pipe move together above the base.</figcaption>
</figure>
```

Static drawings work in exports and without scripts; bound controls hydrate
the same component. The title is its accessible name. The default 640×400
frame scales with its container; set
`width`/`height` (up to 4096), `azimuth` (0–360°, default 45°) and `elevation`
(5–85°, default 30°) for composition. x/y are the ground plane; z points up.
Use one unit throughout.

## Shape vocabulary

Every part and child has a globally unique short `key`. `tone` is `neutral`
(default), `accent`, `secondary` or `muted`.

| kind | Compact geometry |
| --- | --- |
| `slab` | `x,y,z,width,depth,height`; optional rounded corner `radius` |
| `cylinder` | centre `x,y`, bottom `z`, `radius,height` |
| `prism` | closed, simple 2D outline `points: [ [x,y], … ]`, bottom `z`, extrusion `height` |
| `revolve` | `origin: [x,y,z]`, `profile: [ [radius,height], … ]`; optional `axis` (default `[0,0,1]`) and `segments` (default 32) |
| `sweep` | `points: [ [x,y,z], … ]`, `radius`; optional `curve:"bezier"` for exactly four control points, `steps` (default 24 for bezier), `segments` (default 12) |
| `line` | 3D `points`; optional `curve:"bezier"` (four control points), `dashed:true`, `arrow:true` |
| `group` | `parts:[…]` containing shapes that move as one assembly; no nested groups |

**Extrude:** a prism preserves concave notches and accepts either winding.
Its outline must enclose area without self-intersection. Extrude an airfoil
section along its span, then use `orientation` to place it in the scene.

**Revolve:** each pair gives radius and distance along the axis. A boiler can
start at radius zero, follow its outside and end at zero. For a hollow cup,
continue across the rim and down the inside to the floor, as above. Do not
cap its mouth with a disc. Use an arbitrary nonzero `axis` for a horizontal
shaft or a vertically mounted dial.

**Sweep:** a polyline follows its supplied points; a cubic bezier uses start,
first handle, second handle, end. The kit transports circular sections along
the centreline and closes the ends. Use gentle bends with radius smaller than
the bend radius; self-intersecting tubes are not boolean solids.

**Repeat:** add `repeat:{count:8,step:[10,0,0]}` for ribs or grille cells.
For radial copies, replace `step` with
`rotation:{axis:[0,0,1],origin:[0,0,0],degrees:45}`. Both can combine.
Copies rotate then translate, after orientation; keep one definition.

**Orient:** any shape can add
`orientation:{axis:[1,0,0],origin:[0,0,0],degrees:90}`. This is a fixed rotation
about an axis through `origin` (default zero), applied before repetition.
Use the scene's angle control below for reader-controlled rotation.

The component bounds cost: at most 300 parts including group children,
256 points per prism/line, 128 profile or sweep points, 8–64 radial segments,
2–128 bezier steps and 1–64 repeated copies. The whole scene has a 20,000
surface/line-segment budget. Prefer a few well-shaped profiles over increasing
resolution. Smooth surfaces have contour and crease strokes, not mesh edges.

## Controls and motion

Declare parameters as page `<Value>`s. Bind the Isometric and its controls to
the same values; no author script is needed for these interactions.

- **Separate:** a top-level part/group's `separation:[dx,dy,dz]` is its full
  displacement at `spread={1}`. `spread={0}` assembles it; `spread="$spread"`
  binds a numeric Value. Group children inherit the group's movement.
- **Rotate:** add `rotation:{axis:[0,1,0],origin:[0,0,40],range:[-4,10]}` to a
  top-level part/group. Bind the figure's `angle="$angle"` and a Slider to the
  same numeric Value in degrees. The axis passes through `origin`. The angle
  clamps to the declared `range` (default −15–15°). Fixed supports stay still.
- **Flow:** dashed lines can animate with `flow={true}` or `flow="$flow"`
  bound to a boolean Value. This is illustrative dash motion, not physics.
- **Ease:** `motion="smooth"` eases spread and angle;
  the default `motion="instant"` updates directly. Reduced motion snaps and
  stops flowing dashes. The component stops work offscreen and cleans up.

Use `Button set={{"angle":0}}` for a reset and
`Button set={{"flow":false}}` / `set={{"flow":true}}` for pause/play.
The angle Slider's min/max should match the rotating group's range.

The camera fits the declared motion envelope once; scrubbing does not zoom.
Top-level parts draw in array order, back to front. Within a group, surfaces
are sorted by depth. Put overlapping components in the same group when they
need that shared ordering. This is a projected illustration, not a general
3D boolean or intersecting-solid engine. Check both motion extremes.

## Clean technical drawing style

The default `appearance="outline"` gives ink contours, fine creases and pale
opaque washes. Use `appearance="solid"` for stronger colour and shading.
Prism `section:true` accents its end caps. Lines accept `width` (up to 6px)
and `opacity` (0–1) for ribs, flow and force arrows.
Keep most hardware neutral; reserve accent colour for the subject and a
secondary colour for force/flow. Opaque fills hide rear edges. Do not stroke
every polygon of a curved surface: those are tessellation edges, not seams.
Add intentional seams as `line` shapes. Labels, captions and a quiet grid can
live in the surrounding markup/CSS. Read [complex shapes](explainer-shapes.md)
for section design, layering and an airfoil construction recipe.

## Other renderers and verification

Use author-script SVG, Canvas or WebGL for needs outside this spec, such as
continuous deformation, a numerical field or a freely orbiting 3D scene.
Follow [scripts](markup-scripts.md) and [motion](markup-motion.md); keep state
in page Values and stop loops on cleanup/offscreen. Do not expand a supported
Isometric spec into raw SVG as an escape hatch.

Check desktop and 390px, light/dark modes, control extremes, keyboard input
and reduced motion. Inspect rims, joints and occlusion. Keep source compact
and the explanation understandable without animation.
