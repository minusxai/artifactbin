---
name: themes-organic
description: >-
  The organic theme's chart and structural rules, Do/Don't. Optional: the brief's token classes are enough for a plain document; read this only to spend the palette deliberately.
order: 2
---
## Read first

[[ theme.description ]]
Fonts: [[ theme.fonts ]].
Default mode: [[ theme.defaultMode ]] (set `colorMode` to pin the other; readers can flip at view time).

Tokens: "accent" in this guidance means the `primary` token — `text-primary`, `bg-primary`,
`border-primary`; the alert/exception colour is `destructive` (`text-destructive`, `bg-destructive`).
The CSS token `--accent` is a quiet neutral surface tint in every theme — never the accent.
Organic — warm, rounded, human. `rounded-2xl` and up, soft shadows, terracotta focal with
olive support; the voice is friendly and the shapes agree with it. Whitespace is soft, not
architectural — sections breathe into each other. In dark the ground is deep moss with cream
text; the terracotta stays the focal voice, just lifted.
Charts: terracotta focal, olive secondary; area fills at low opacity feel at home here.
Structural: `<hr>` is a short rounded terracotta dash (a friendly beat mark, not a wall);
`<blockquote>` becomes a soft rounded tinted block.
Do: rounded chart containers, pill badges, warm muted backgrounds alternating with cream.
Don't: hard edges or 0-radius anything, pure black text, corporate blue, airless dense
tables, neon accents.

Author with token classes (`text-muted-foreground`, `bg-muted`, …) and the
theme does the rest — hardcoded palettes fight it. Components:
[markup.md](markup.md).
