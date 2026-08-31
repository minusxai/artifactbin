---
name: themes-modernist
description: >-
  The modernist theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 1
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Modernist — Swiss editorial discipline. In light the red `--primary` is the ONLY hue on the
page and it always means the subject; everything else is ink on paper. Dark is the same page
inverted — ink-black ground, white type, the one red lifted to stay lit — never a new hue
family. Keep everything flush left — headlines, copy, even wide
CTA-like elements; centered text is off-brand. Dividers are strong
(`border-t-2 border-foreground`), never decorative hairlines everywhere.
Charts: all series in muted grays (`--muted-foreground`), the focal series in the primary;
direct labels over legends; no gradient fills.
Structural: `<hr>` renders as a strong 2px ink rule and `<blockquote>` carries a bold top
rule — use them as section dividers instead of hand-styled borders.
Do: visible grid, generous white, uppercase tracked eyebrows, one primary element per viewport.
Don't: round a corner (radius is 0 on purpose), gradients, shadows, a second accent hue,
tinted or decorative imagery.

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
