---
name: templates
description: >-
  How to choose a genre when the ask does not name one. The brief already carries a usable grammar for all four — read this only to compare genres; then only the chosen genre's file, if at all.
---
## Read first

Pick ONE by the content's shape, then read its file for the beats and layout
grammar — details about a genre you didn't pick are noise:

[% for t in templates %]
- `[[ t.name ]]` — [[ t.description ]] → [`templates-[[ t.name ]].md`](templates-[[ t.name ]].md)
[% endfor %]

Choosing: when the ask clearly names a genre (slides → `deck`, operating
view → `dashboard`, board report / long-read → `editorial`), pick it. When
it is NOT obvious from the user's instructions, **default to `scrolly`** —
its conceit-led, designed treatment (at whatever register the subject can
carry, deadpan included) is the strongest default for an unspecified ask.
If you are genuinely torn between readings, clarify with the user and offer
the candidate genres as options rather than guessing.

## What a template is

A `template` is the document's structural GENRE — its beat structure and
layout grammar — orthogonal to the design `theme`, which is purely a token
set ([themes.md](themes.md)). Set it as the top-level
`template` field of the publish call. It is a REFERENCE, not a contract: each
file documents a genre's beats as a proven starting point, and a structure
derived from the subject itself beats any of them. Deviate deliberately, or
omit the `template` field and go bespoke — that is a first-class choice, not
a fallback. The component vocabulary every genre is built from:
[markup.md](markup.md).

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
