---
name: themes-manuscript
description: >-
  The manuscript theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 5
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Manuscript — the serif slot: bookish print with a newsroom's discipline. Serif air, generous
leading, hairline rules; the oxblood accent is an illuminator's ink — initials, rules, the
focal series — never large fills. Drop caps and small-caps kickers are welcome; figures may
sit in the margin like plates in an atlas; tables are first-class graphics with strong
header rules. In dark the page is warm brown-black under a reading lamp — cream text, the
accent turning ochre — never a cold screen inversion.
Charts: muted earth tones with the accent focal series; serif axis labels feel right here.
Structural: `<hr>` is a hairline; `<blockquote>` sets italic with a fine left rule; table
`<th>` sets in tracked small caps — native tables already look typeset.
Do: wide margins, `max-w-prose` columns, numbered figures with captions ("Fig. 2 — …"),
multi-column long prose (`@3xl:columns-2`), datelines.
Don't: neon or saturated hues, heavy shadows, condensed grotesque headlines, large radii,
dense borderless tables.

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
