---
name: themes-pop
description: >-
  The pop theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 6
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Pop — chunky, saturated, loud. Candy magenta is the star, cyan and amber the supporting
cast; radii are big (`rounded-3xl` feels native), headings are heavy (the theme sets 800),
and blocks of tinted background are welcome. The energy comes from scale contrast — one
huge thing per viewport, everything else small and tidy — not from scattering color
everywhere. Dark mode is deep plum with the candy hues brightened, still playful.
Charts: the magenta focal with cyan/amber support; rounded bars and dots at home here; keep
gridlines quiet so the candy reads.
Structural: `<hr>` is a fat rounded magenta dash and `<blockquote>` a tinted rounded slab —
use them as rhythm marks.
Do: oversized numerals, pill badges, tinted section bands, playful emoji-scale icons,
generous padding.
Don't: hairline-serious minimalism, gray-on-gray, more than three saturated hues in one
view, small timid headings, sharp corners.

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
