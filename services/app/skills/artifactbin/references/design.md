---
name: design
description: >-
  Design craft: the thesis, hierarchy, type, space, colour, motion, charts and copy, and the default-AI looks to avoid. Read for a document a human will judge by eye, after the page type and the design system are chosen.
---
## Read first

<!--bundle:skip-->
Choose deliberately; the kit supplies components, the design system their appearance. Use only needed content.

<!--/bundle:skip-->
Three choices, in this order, each from its own reference: the PAGE TYPE
from the content's shape ([templates.md](templates.md)), the DESIGN SYSTEM
from the subject's world ([design-systems.md](design-systems.md)), then
the THESIS from the subject itself (below). The system carries the fonts,
the palette, both colour modes, the type roles and the components; what
your own Helmet CSS adds, you carry yourself:

- **A family the system lacks is a Helmet meta**:
  `<meta name="font-display" content="Lobster" />` (also `font-body`,
  `font-mono`) names a Google family; the page imports it from Google Fonts.
  Spend it only where the subject demands a face no system carries.
<!--bundle:skip-->
- **Colour mode is a root class the reader flips**, not a media query: every
  system ships light AND dark and `colorMode` picks your default. Author in
  token classes and both follow; hand-written colours must define both and
  paint the background explicitly.
<!--/bundle:skip-->
<!--bundle:skip-->
- **Every number a viewer might question comes from data**: a `<Query>` in
  `<Helmet>`, bound with `data="$name"`, never a typed-in figure.
<!--/bundle:skip-->
- Utilities compile `!important`; never fight one from a style block. Give
  keyboard focus a visible state.

**Plans:** UI plans use [templates-plan.md](templates-plan.md); other workflows use
useful visuals. Todos use plain lists or tables, without checkboxes. Strike
completed labels (`<s>`), preserving context. Save progress by editing.

<!--bundle:skip-->
## Contents

Calibrate the treatment · Ground it in the subject · The thesis · Hierarchy ·
Typography · Space · Colour · Motion · Charts · Copy · Structure · When it is a
UI · Avoid the default AI look · Restraint.

## Calibrate the treatment

- Match the treatment to the reader’s task. Working reports need clear
  hierarchy and useful detail. Presentations can be more expressive. Let
  the chosen design system set the visual register.
<!--/bundle:skip-->

## Ground it in the subject

- Pin one concrete subject, its audience, and the page's single job before
  authoring.<!--bundle:skip--> Distinctive choices come from the subject's own world, its
  materials, instruments and vernacular, not from a house style.<!--/bundle:skip-->
- Build with real content throughout, never lorem placeholder.

## The thesis

State the reader's benefit, the visual idea and the role of the evidence in
one sentence. “A shift briefing that identifies the largest backlog and
opens its ledger” is a thesis; “clean, modern, blue” is a style label.

- **The object.** Choose a concrete subject to draw in the system's `h-*`
  classes. Carry it through figures and chapter labels without adding
  unrelated motifs.
- **The device.** Choose which system device carries the data: a split bar,
  stamp or ledger.

Name the rejected default: the composition a generic page would use.
If that describes your thesis, revise it.<!--bundle:skip--> See
[worked-briefs.md](worked-briefs.md) for examples.<!--/bundle:skip--> Record the
system and thesis in the Helmet comment so later edits preserve the design.

## Hierarchy

- One idea per viewport. A headline states the FINDING ("Churn halved after
  onboarding"), never the topic ("Churn analysis").
- Contrast in size is the design: small uppercase tracked eyebrows against
  large tight headlines beats five mid-sized headings.
- Body copy caps at `max-w-prose` (~65ch); evidence (charts, tables) breaks
  wider. Width contrast IS the layout.

## Typography

- The PAIRING comes with the system, chosen as a set; never fight it with a
  second family. Its type roles (`t-display-l`, `t-title`, `t-body`,
  `t-label`, `t-numeral`) set size, leading, weight and tracking; headings
  take the display face without a class.
- Spend the roles in three jobs. DISPLAY carries the argument: few, large,
  using the system's casing. BODY carries reading, capped at `max-w-prose`. UTILITY
  carries the apparatus: eyebrows, folios, figure numbers, table digits.
- Stay on the system's scale; a size utility on an element that carries a
  role replaces the role, so put layout utilities there and never type ones.
<!--bundle:skip-->
- Casing, tracking and weight follow the system's type roles; aligned digits
  get `tabular-nums`. Preserve a clear hierarchy between display and body.
<!--/bundle:skip-->

## Space

- Whitespace is structure, not waste. Use the system's spacing rhythm; the
  gap between sections exceeds the gap within one. Space sibling groups with
  flex/grid `gap-*`, not per-element margins.
- Align to the grid; when in doubt, flush left. Centered body copy is almost
  always wrong. Wide content (tables, code) gets its own `overflow-x-auto`
  container; the page never scrolls sideways.

## Colour

- The system owns hue: author in its token classes. A subject that needs its
  own hue gets ONE `--ds-*` token reassigned under `:root` and `.dark`, and
  every component, chart and device follows; never a second palette.
- Use the system's accent roles consistently: a system may pair several
  expressive colours. Preserve a focal hierarchy and distinguish emphasis
  from status and chart-series colours.
- The runtime paints the system's page ground, including textures. Leave
  layout wrappers transparent; opaque panels and sections are intentional
  surfaces, not a blanket `bg-background` over the whole document.
- Status colour (positive, caution, negative) is separate from the accent and
  always travels with a word or a glyph, never colour alone.

## Motion

- Motion deliberately: one orchestrated moment lands harder than scattered
  effects, and extra animation reads as AI-generated. The vocabulary is
  [markup-motion.md](markup-motion.md); the system's motion rules set the register.

## Charts

- Label axes with names, units and ticks. Keep legends unless directly labeled.
- The system's chart series order, unless the user requests custom colours.
  [Chart guidance](markup-data-authoring.md).

## Copy is design material

- Use plain words and active voice. Lead with the fact or action; cut AI
  filler, hype and repeated conclusions. Keep terminology consistent.
- Avoid decorative contrastive negation (“It's not X; it's Y”). State the
  claim directly; reserve contrast for a real distinction or misconception.
- Avoid text blobs: one topic per paragraph, usually 1–3 sentences and
  about 60 words or fewer. Use lists for steps and tables for comparisons.
- Use ASD-STE100-inspired sentence limits: 20 words for instructions,
  25 for descriptions. Preserve facts, qualifications and necessary detail.
  These are aspirational editing targets, not a claim of formal STE compliance.
- Controls name their action; errors explain the problem and the remedy.
  See [copy guidance](copy.md) for examples and the final editing pass.

## Structure is information

- Eyebrows, numbering, dividers and labels must encode something TRUE about
  the content, not decorate it.
- Numbered markers (01 / 02 / 03) only when the content really is a sequence
  whose order the reader needs.

<!--bundle:skip-->
## When it is a UI, not a document

- A dashboard is scanned and operated, not read: summary before detail;
  what needs attention reads at a glance.
- Encode state in form as well as number (a badge, a severity stripe) and
  make what's interactive look interactive.

<!--/bundle:skip-->
## Avoid the default AI look

Unprompted AI design clusters around a few looks: cream + serif + terracotta;
near-black with one acid accent; a purple-blue gradient hero; emoji as
section markers; everything centered; rounded cards with accent rails. If
your user asks for one of these, follow their words exactly;<!--bundle:skip--> otherwise don't
spend your freedom there: pick the system and the composition from the
SUBJECT, not from habit, and let the thesis carry the one bold moment.<!--/bundle:skip-->

## Restraint

- Prefer plain typography over one more Card. Decoration that carries no
  information comes out.
<!--bundle:skip-->
- Spend your boldness in ONE place; keep everything around it quiet.
- Pick the system for the subject and let it work.
<!--/bundle:skip-->
