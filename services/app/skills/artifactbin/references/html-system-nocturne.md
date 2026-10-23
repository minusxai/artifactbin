---
name: html-system-nocturne
description: Native HTML tokens, typography and composition for Nocturne, generated from its retained specification.
---
## Read first

**Nocturne: Read it slowly, by one lamp.** Long reads, features, evening and culture subjects. Atmospheric; opens dark.

## Bind ordinary HTML

Set `<html data-af-design-system="nocturne" data-af-dark="true">`. Copy the installed `design-systems/nocturne.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-night` | #f3e7ca | #050818 |
| `--ds-night-raised` | #faf1dc | #111940 |
| `--ds-night-sunk` | #e9dbb9 | #02040f |
| `--ds-line` | #d3b98b | #2a3568 |
| `--ds-ink` | #1d170f | #ece6d6 |
| `--ds-ink-soft` | #4a3d2c | #b9c8ee |
| `--ds-ink-muted` | #8a7a60 | #8d98c0 |
| `--ds-lamp` | #9a5a12 | #ffc76e |
| `--ds-on-lamp` | #fff6e4 | #1a1206 |
| `--ds-lamp-hot` | #b8661f | #ffe2a8 |
| `--ds-lamp-soft` | #f3e5c2 | #241d30 |
| `--ds-ember` | #b8551a | #ff9440 |
| `--ds-on-ember` | #fff6e4 | #1a0e04 |
| `--ds-cool` | #3a5a8a | #b9c8ee |
| `--ds-positive` | #2b5a45 | #6fcf97 |
| `--ds-positive-soft` | #dcebe1 | #10291e |
| `--ds-caution` | #8a5a00 | #ffd27a |
| `--ds-caution-soft` | #f3e5c2 | #2e2306 |
| `--ds-negative` | #8a2d1c | #ff7a5c |
| `--ds-negative-soft` | #f4dcd8 | #3a1412 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(48px, 7.5vw, 104px) / .92 | One per page. Newsreader light at display size; the emphasised phrase goes italic in lamp-hot. |
| `t-display-l` | display | clamp(32px, 4.5vw, 56px) / 1 | Section openers and chapter heads. |
| `t-display-italic` | display | clamp(32px, 4.5vw, 56px) / 1 | The emphasised phrase inside a headline, in lamp-hot with the text glow. |
| `t-caps` | caps | 12px / 18px | Kickers, chapter marks, folios. Cinzel, widely tracked, with a 34px rule before it. |
| `t-title` | display | 24px / 30px | Panel and figure titles. |
| `t-body-l` | sans | 21px / 34px | Standfirsts and lead paragraphs. Light weight, long leading. |
| `t-body` | sans | 18px / 30px | Reading text, oldstyle numerals. Long reading is the point. |
| `t-note` | sans | 15px / 22px | Marginalia, figure notes, asides. |
| `t-label` | mono | 11px / 16px | HUD counters, captions, table heads. Mono caps, small. |
| `t-numeral` | mono | 40px / 44px | Figures. Tabular; lamp when it is the one that glows. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
