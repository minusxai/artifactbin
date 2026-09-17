---
name: themes-terminal
description: >-
  The terminal theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 4
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Terminal — green phosphor on glass. Mono type for EVERYTHING (headings included — that is the voice), and
it opens dark by default: near-black ground, neon green primary, cyan and magenta as chart
support. A restrained glow (a soft primary-tinted shadow on the hero figure) is on-brand;
prompt markers (`$`, `>`), tracked uppercase kickers and `tabular-nums` KPI rows carry the
register. The light mode is a paper terminal — warm off-white with the green darkened to
ink weight — never a generic white page.
Charts: luminous lines on the dark field, gridlines barely-there, two lit hues max per view;
direct labels in mono.
Structural: `<hr>` is a thin primary rule (a scanline) and `<blockquote>` carries a green
left bar — ready-made section dividers.
Do: big mono hero numbers, ASCII-flavored ornaments used sparingly, status chips
(`● live`), dense ordered tables.
Don't: serifs anywhere, rounded-2xl softness, pastel fills, three glowing colors in one
chart, long paragraphs in pure neon (body copy stays in the muted foreground).

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
