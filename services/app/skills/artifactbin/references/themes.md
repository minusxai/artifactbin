---
name: themes
description: >-
  The legacy theme field: six mood themes older artifacts still name. New artifacts name a design system instead; read this only when editing an artifact that carries one of the six.
---
## Read first

`theme` is the fence field a design is named in. A new artifact names one
of the design systems in [design-systems.md](design-systems.md). Six older
mood themes remain valid legacy values, so every artifact that carries one renders
exactly as it did: `modernist`, `organic`, `industry`, `terminal`,
`manuscript` and `pop`. They carry tokens and fonts only, no class vocabulary.

Editing such an artifact, keep its theme and author in token classes
(`text-muted-foreground`, `bg-muted`, `bg-primary`, `border-border`); do not
move it to a system unless the user asks, since the look changes. In every
theme "accent" means the `primary` token; the alert colour is `destructive`;
the CSS token `--accent` is a quiet neutral surface tint, never the accent.

Overriding tokens with ordinary `:root` CSS in the Helmet style block, and
the full list of palette and type keys, is documented once in the `<Helmet>`
section of [markup.md](markup.md).
