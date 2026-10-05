---
name: design
description: >-
  Design craft: the thesis, hierarchy, type, space, colour, motion, charts and copy, and the default-AI looks to avoid. Read for a document a human will judge by eye, after the page type and the design system are chosen.
---
## Read first

<!--bundle:skip-->
Approach every artifact as the design lead at a small studio known for
versatility: deliberate choices, never templated. The kit gives you
components and the system gives you the look; use FEWER of them, better.

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

- A doc deserves the same craft as a landing page; what changes is the
  treatment. A plan, memo or working report wants a UTILITARIAN treatment:
  real hierarchy, considered spacing, the system's quiet register, no giant
  hero. Something the user will keep, present or share wants an EDITORIAL
  treatment: opinionated calls, one real aesthetic risk where it serves the work.
<!--/bundle:skip-->

## Ground it in the subject

- Pin one concrete subject, its audience, and the page's single job before
  authoring.<!--bundle:skip--> Distinctive choices come from the subject's own world, its
  materials, instruments and vernacular, not from a house style.<!--/bundle:skip-->
- Build with real content throughout, never lorem placeholder.

## The thesis

One sentence before you build: the reader's benefit, the organizing visual
idea, and how the evidence or the actions fit it. "A shift briefing that
surfaces the queue with the largest overdue backlog, then opens its ledger"
is a thesis; "clean, modern, blue" is a style label. The thesis names
two things the system never supplies:

- **The object.** One thing from the subject's own world, drawn in the
  system's hand (its `h-*` classes) and carried through the chapter labels,
  the figure numbering and one small drawing: the page's motif. One
  object, total commitment, no second conceit; a quiet thesis in a deadpan
  register is as valid as a loud one.
- **The device.** Which of the system's devices carries the data: the split
  bar, the stamp, the ledger. The data lives inside it.

Name the rejected default too: the composition any similar page would
have had; if your thesis is that default, revise it.<!--bundle:skip--> The page
type's guide offers two or three compositions; [worked-briefs.md](worked-briefs.md)
shows six theses with their rejected defaults.<!--/bundle:skip--> Record system and
thesis in the Helmet comment, so a later edit extends the design instead of reskinning it.

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

<!--bundle:skip-->
## Copy is design material

- Write from the reader's side of the screen: name things by what people
  recognize, not how the system is built.
- Active voice; a control says exactly what happens. Errors say what went
  wrong and how to fix it, no apologies, no vagueness. Specific beats clever.

<!--/bundle:skip-->
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
