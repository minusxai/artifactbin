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
