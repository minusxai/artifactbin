---
name: templates
description: >-
  The seven page types and when each fits; then read only the chosen one.
---
## Read first

Pick ONE by the content's shape, then read its file for the compositions it
offers and what the runtime needs from it; details about a page type you
didn't pick are noise:

[% for t in templates %]
- `[[ t.name ]]` — [[ t.description ]] → [`templates-[[ t.name ]].md`](templates-[[ t.name ]].md)
[% endfor %]

Choosing: when the ask names a page type (slides → `deck`, an operating view
→ `dashboard`, an implementation or rollout plan → `plan`, a report, article,
briefing or long read → `editorial`, a tool people operate → `app`, an offering to choose
→ `landing`, a story told by scrolling → `scrolly`), pick it. When it is NOT
obvious, the reader's job decides: what must they understand or do first, and
how much do they read before they act? There is no default page type. If you
are genuinely torn between readings, clarify with the user and offer the
candidate page types as options rather than guessing.

“Make a report” selects `template: editorial` by default; editorial is the
internal page-type name, not a requirement to write an opinion piece. Choose
its composition from the content. Explicit requests for a live monitoring
report select `dashboard`; a report presented as slides selects `deck`.

## What a page type is

A `template` is the document's PAGE TYPE: its structural genre, and the
runtime behaviour that comes with it, which is the contents rail beside an
`editorial` or `plan` page with three or more `h2` sections and present mode
for a `deck`'s `<Slide>` nodes. Set it as the top-level `template` field.
`app` and `landing` carry no runtime behaviour; the field still records the
type. A page type's guide is a REFERENCE, not a contract: it offers two or
three compositions, and the thesis ([design.md](design.md)) picks one; a
structure derived from the subject itself beats any of them. The design
system ([design-systems.md](design-systems.md)) owns the look of whatever
structure you choose and carries a specimen for the page types it fits. The
component vocabulary every page type is built from: [markup.md](markup.md).

The system owns the page ground, textures, surfaces, type, rules, depth and
motion. Keep layout wrappers transparent; the runtime paints the ground.
Opaque panels and sections are deliberate system treatments, not a default
`bg-background` on every document. Compositions below are starting points:
use the system's visual vocabulary while preserving semantic reading order,
legible prose, keyboard access, responsive stacking and bounded overflow.

## Editable columns

For prose columns, sidebars, comparisons and mixed text/evidence layouts, prefer
`<Grid mode="flow"><GridItem w={8}>…</GridItem><GridItem w={4}>…</GridItem></Grid>`.
Use it liberally when a layout has columns; keep ordinary single-column prose
as ordinary HTML. Public components remain Grid / GridItem in both modes.
Flow follows source order, stacks below 42rem of container width and grows
with content. Widths use the same 12-column default (`cols` can change it).
A divider changes adjacent spans together; the editor's dedicated grip moves
source blocks. Never author x/y/h in flow mode. A deliberate vertical resize
sets `minHeight` in pixels; omit it for automatic height. Content always grows
past that minimum, and Auto height clears it. Default positioned Grid keeps
x/y/w/h geometry for dashboards whose embeds fill fixed tiles.
