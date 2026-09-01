---
name: design
description: >-
  Design craft: treatment, motif, hierarchy, type, space, color, charts, the default-AI looks to avoid. Read only for a document a human will judge by eye and only if no design skill is already held.
---
## Read first

Approach every artifact as the design lead at a small studio known for
versatility: deliberate choices about palette, type, and layout, pitched at
the treatment the task actually calls for — never templated. The kit gives
you components; this page is about using FEWER of them, better.

The theme carries the fonts, the palette and both color modes; what your own
Helmet CSS adds, you carry yourself:

- **A family the theme lacks is a Helmet meta, never CSS**:
  `<meta name="font-display" content="Lobster" />` (also `font-body`,
  `font-mono`) names a Google family, served from this origin; an unknown one
  fails the publish. CSS `url()`/`@import` is stripped at save, so a font CDN
  link never paints.
- **Color mode is a root class the reader flips**, not a media query: every
  theme ships light AND dark and `colorMode` picks your default. Author in
  theme tokens and both follow; hand-written colors must define both and paint
  the background explicitly — a transparent body borrows the viewer's ground.
- **Every number a viewer might question comes from data** — a `<Query>` in
  `<Helmet>`, bound with `data="$name"` — never a typed-in figure.
- Choose your neutrals: a grey with a slight hue bias toward the accent reads
  as chosen; a pure mid-grey reads as unconsidered. Watch selector
  specificity (don't let two classes fight over section spacing) and give
  keyboard focus a visible state.

## Contents

Calibrate the treatment · Ground it in the subject · Plan before you build ·
The subject motif · Hierarchy · Typography · Space · Color · Motion · Charts ·
Copy · Structure · When it is a UI · Avoid the default AI look · Restraint.

## Calibrate the treatment

- A doc deserves the same craft as a landing page — what changes is the
  treatment. A plan, memo or working report wants a UTILITARIAN treatment:
  real hierarchy, considered spacing, a proper palette, no giant hero.
  Something the user will keep, present or share — a launch page, a deck, a
  flagship report — wants an EDITORIAL treatment: opinionated calls, one real
  aesthetic risk where it serves the work.
- When unsure: a well-composed page is never the wrong answer; an
  over-designed one sometimes is.

## Ground it in the subject

- Pin one concrete subject, its audience, and the page's single job before
  authoring. Distinctive choices come from the subject's own world — its
  materials, instruments, vernacular — not from a house style.
- Build with real content throughout, never lorem placeholder.

## Plan before you build

Sketch a compact plan first: which theme and WHY ([themes.md](themes.md)),
the layout concept in a sentence, where the one bold moment goes, and the
subject's MOTIF (below). Templates ([templates.md](templates.md))
are references, not contracts — deviate where the subject knows better, omit
one when the subject suggests its own structure. If any part of the plan
reads like the generic default for any similar page, revise it. Then build.

## The subject motif

The strongest pages carry ONE device drawn from the subject's own world and
commit every label to it: a video explainer whose chapters are frame ranges
under a drawn frame-ruler; an incident report typeset as a flight recorder
log. This is the scrolly template's "conceit" — but it works at ANY register,
deadpan as well as theatrical: a sober technical explainer with mono chapter
stamps and an inline-SVG motif reads as designed without a single joke.
Express it in the chapter labels, the figure numbering, and one small drawn
SVG element — then stop; one motif, total commitment, no second conceit.

## Hierarchy

- One idea per viewport. A headline states the FINDING ("Churn halved after
  onboarding"), never the topic ("Churn analysis").
- Contrast in size is the design: small uppercase tracked eyebrows against
  large tight headlines beats five mid-sized headings.
- Body copy caps at `max-w-prose` (~65ch); evidence (charts, tables) breaks
  wider. Width contrast IS the layout.

## Typography

- The PAIRING comes with the theme — display, body and (mostly) a mono
  utility face, chosen as a set. Never fight it with a second family; the one
  sanctioned accent is a color, not a font.
- Spend it in three ROLES. DISPLAY carries the argument: few, large,
  `tracking-tight`, `text-balance`, sentence case. BODY carries reading:
  `leading-relaxed`, capped at `max-w-prose`. UTILITY (`font-mono`) carries
  the apparatus — eyebrows, folios, figure numbers, table digits, captions.
  Every template's "Type register" says how the genre spends them.
- Set a SCALE and stay on it: 3-4 sizes with a real jump between roles
  (`text-xs` apparatus · `text-base`/`text-lg` body · `text-4xl`+ display).
- Uppercase belongs to the apparatus only, always tracked (`tracking-widest`);
  never letterspace lowercase body copy. Aligned digits get `tabular-nums`.
- Weight is hierarchy's cheapest lever — `font-semibold` headings over bold
  paragraphs; if everything is bold, nothing is.

## Space

- Whitespace is structure, not waste. Pad sections generously (`py-16`); the
  gap between sections exceeds the gap within one. Space sibling groups with
  flex/grid `gap-*`, not per-element margins.
- Align to the grid; when in doubt, flush left. Centered body copy is almost
  always wrong. Wide content (tables, code) gets its own `overflow-x-auto`
  container — the page never scrolls sideways.

## Color

- The theme owns hue: author in its tokens, and spend the one sanctioned
  bespoke accent only where the subject demands a hue no theme carries.
- ONE accent, meaning one thing (the subject, the exception). Context sits in
  grays. If everything is highlighted, nothing is.
- Semantic state color (good / warning / critical) is separate from the
  accent and doesn't count as your accent.

## Motion

- Leverage motion deliberately: a page-load sequence, a scroll-triggered
  reveal, hover micro-interactions, ambient atmosphere. One orchestrated
  moment lands harder than scattered effects; extra animation reads as
  AI-generated. The vocabulary — keyframes, the kit's one-class shortcuts, the
  scroll-reveal observer — is [markup-motion.md](markup-motion.md); the
  judgment is yours.

## Charts

- The title states the takeaway; axes and units do the explaining.
- Direct labels beat legends; gridlines stay barely-there; no gradients,
  shadows, or 3D — data-ink only.

## Copy is design material

- Write from the reader's side of the screen: name things by what people
  recognize, not how the system is built.
- Active voice; a control says exactly what happens. Errors say what went
  wrong and how to fix it — no apologies, no vagueness. Specific beats clever.

## Structure is information

- Eyebrows, numbering, dividers, and labels must encode something TRUE about
  the content, not decorate it.
- Numbered markers (01 / 02 / 03) only when the content really is a sequence
  whose order the reader needs.

## When it is a UI, not a document

- A dashboard is scanned and operated, not read: summary before detail;
  what needs attention reads at a glance.
- Encode state in form as well as number — a badge, a severity stripe — and
  make what's interactive look interactive.

## Avoid the default AI look

Unprompted AI design clusters around a few looks: cream + serif + terracotta;
near-black with one acid accent; a purple-blue gradient hero; emoji as
section markers; everything centered; rounded cards with accent rails. If
your user asks for one of these, follow their words exactly; otherwise don't
spend your freedom there — pick the theme and structure from the SUBJECT, not
from habit.

## Restraint

- Prefer plain typography over one more Card. Decoration that carries no
  information comes out.
- Spend your boldness in ONE place; keep everything around it quiet.
- Pick the theme for the mood and let it work.
