---
name: themes-industry
description: >-
  The industry theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 3
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Industry — the engineering report. Slate ground, industrial blue as the working color, and
safety orange RESERVED for the one exception being discussed (the outlier, the alert, the
threshold breach) — if everything is orange, nothing is. Square corners, mono figures,
visible grid discipline. Dark mode is dark slate with the blue lifted; orange stays the one
exception in both.
Charts: blue primary, gray context series, orange only on the flagged element; reference
lines and thresholds drawn explicitly.
Structural: `<hr>` is a dashed engineering rule; tables default to tabular figures with
uppercase headers — spec-sheet look for free.
Do: spec-sheet tables, labeled thresholds, `tabular-nums`, section numbering (1.0, 1.1).
Don't: pastels, decorative serifs, rounded cards, orange as decoration, unlabeled axes.

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
