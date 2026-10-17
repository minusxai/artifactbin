---
name: explainer-shapes
description: Section design and assembly recipes for the declarative Isometric component, including an angle-controlled airfoil.
---
## Read first

Read [explainers](explainers.md) for the complete shape contract. A document
stores profiles, control points and assembly relationships. The kit generates
its surfaces, linework and motion. Do not store generated SVG paths or copy a
geometry library into the document.

## Contents

- [Construction](#section--surface--assembly) · [Airfoil](#an-airfoil-bench)
- [Detail](#detail-without-duplicated-geometry) · [Contours](#layering-and-contours) · [Motion](#motion-without-page-code)

## Section → surface → assembly

Choose the construction matching the object's cross-section:

- A plate, bracket or wing: `prism` extrudes a simple closed outline. Concave
  notches remain open. Outline winding and starting vertex do not matter.
- A knob, cup, bearing or vessel: `revolve` turns radius/height pairs around an
  axis. Include the inner wall in the profile for a hollow part. A rim is an
  annulus; it should not cover the opening with a disc.
- A hose or handle: `sweep` takes a polyline or four cubic-bezier control
  points. Keep neighbouring points distinct and bends wider than the tube.

Use `orientation` to turn a local shape into world coordinates. Use `repeat`
for ribs, bolts and grille cells. Put shapes that move together into a `group`.
Group children have no separate motion; put independently moving assemblies
at the top level. Give every definition a unique key, including children.

## An airfoil bench

This short section is illustrative geometry, not a certified airfoil dataset.
The prism's local x/y section becomes world x/z after a 90° turn about x;
its extrusion runs along negative y. Its top-level group rotates around a
spanwise axis while the base remains fixed.

```jsx
<Helmet><Value name="angle" type="number" default={6} /></Helmet>
<Isometric title="Airfoil incidence on a fixed bench" appearance="outline"
  angle="$angle" motion="smooth" width={900} height={560}
  parts={[
    {"key":"bench","kind":"slab","x":-25,"y":-100,"z":0,"width":150,"depth":130,"height":6,"radius":5},
    {"key":"support","kind":"cylinder","x":25,"y":-35,"z":6,"radius":4,"height":44},
    {"key":"wing","kind":"group","rotation":{"axis":[0,1,0],"origin":[25,0,50],"range":[-4,10]},"parts":[
      {"key":"section","kind":"prism","points":[ [0,50],[3,53],[12,56],[30,57],[55,55],[100,50],[55,48],[25,47],[8,48] ],"z":0,"height":75,"tone":"accent","section":true,"orientation":{"axis":[1,0,0],"degrees":90}}
    ]}
  ]} />
<Slider label="Incidence in degrees" value="$angle" min={-4} max={10} step={0.1} />
<Button set={{"angle":0}}>Zero</Button>
<Button set={{"angle":6}}>6°</Button>
```

Add contour-following `line` shapes to the wing group for intentional ribs;
repeat them along the span. Set `width:0.8,opacity:0.65` for quiet ribs and
`width:4` for a force arrow. `section:true` gives prism end caps their full
tone while the curved skin keeps a pale wash. Use dashed bezier lines for
illustrative flow and bind the figure's `flow` to a boolean Value. A line with
`arrow:true` can show a force direction. Explain that these marks are an
illustration; do not label their spacing or speed as a computed flow field.

For a cleaner curved section, add a few outline samples around the leading
edge rather than thousands of triangles. Use a supplied scientific profile
when the explanation depends on real aerodynamic quantities.

## Detail without duplicated geometry

Repeated structure makes a mechanism convincing: rib spacing, bolt heads,
knurled grips and dial ticks. Keep these as repeated definitions. For example,
this line creates 32 ticks around a dial centred at the world origin:

```jsx
<Isometric title="Dial ticks" parts={[
  {"key":"ticks","kind":"line","points":[ [16,0,2],[18,0,2] ],"width":0.8,
   "repeat":{"count":32,"rotation":{"axis":[0,0,1],"degrees":11.25}}}
]} />
```

Use `origin` on the repeat rotation for a dial elsewhere in the scene. A row
uses `step`; combining rotation and step makes a helical pattern. The order
is fixed orientation, then each copy's rotation, then its translation.
Do not add detail uniformly: emphasize the subject's section and connections;
keep the supporting hardware quieter.

## Layering and contours

Top-level parts are painter-ordered. Within a group the kit sorts faces and
visible edges by depth, hiding back edges behind opaque surfaces. Group
hardware whose surfaces need shared ordering. Deliberately intersecting
solids may need to be split into separate shapes; this renderer does not do
boolean cuts or physically accurate transparency.

The outline appearance uses strong silhouettes, finer creases and quiet
washes. Smooth radial segments do not get a stroke at every mesh boundary.
Use explicit lines only for meaningful seams, gauges and ribs. Keep the base
and supports neutral, the subject accented and explanatory forces secondary.
Verify edges at the final displayed size: enlarging a low-resolution drawing
or colouring every face makes the mechanism harder to read.

## Motion without page code

The component owns easing, reduced-motion handling and visibility cleanup.
`spread` translates top-level assemblies; `angle` rotates the groups that
have a rotation axis. Both read the same Values as the page controls. The
camera fits the motion range once and remains fixed. `flow` controls only
animated dash offset, so a paused scene still communicates its shape.

Geometry stays deterministic for static rendering and export. Check source
size as well as appearance: a detailed assembly should remain a readable
collection of named profiles and relationships, not expanded SVG output.
