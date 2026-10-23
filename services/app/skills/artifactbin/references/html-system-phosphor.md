---
name: html-system-phosphor
description: Native HTML tokens, typography and composition for Phosphor, generated from its retained specification.
---
## Read first

**Phosphor: Green text. Black glass. No lies.** Dev tools, CI, logs, status pages. Technical; opens dark.

## Bind ordinary HTML

Set `<html data-af-design-system="phosphor" data-af-dark="true">`. Copy the installed `design-systems/phosphor.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-glass` | #f2f5ec | #060a06 |
| `--ds-glass-raised` | #fbfcf7 | #0c130c |
| `--ds-glass-sunk` | #e3e9d9 | #030503 |
| `--ds-line` | #c9d3bf | #1b2a1b |
| `--ds-edge` | #0f7a3a | #3dff7a |
| `--ds-ink` | #0f1f12 | #d7ffe0 |
| `--ds-ink-muted` | #4c6b52 | #7fb48f |
| `--ds-green` | #0f7a3a | #3dff7a |
| `--ds-on-green` | #f2f5ec | #04140a |
| `--ds-green-ink` | #0b6a31 | #5fff93 |
| `--ds-green-soft` | #d9f0dc | #0f2a18 |
| `--ds-amber` | #9a6a00 | #ffb000 |
| `--ds-on-amber` | #1a1000 | #1a1000 |
| `--ds-amber-soft` | #f6e9c4 | #2a1e00 |
| `--ds-positive` | #0f7a3a | #3dff7a |
| `--ds-caution` | #9a6a00 | #ffb000 |
| `--ds-negative` | #b3261e | #ff5c5c |
| `--ds-negative-soft` | #f6d9d6 | #2d0e0e |
| `--ds-cyan` | #0b6e7a | #5ee1f0 |
| `--ds-violet` | #5b3fb0 | #b79cff |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(44px, 7vw, 88px) / .95 | One per page. Covers and the headline state of a system. |
| `t-display-l` | display | clamp(30px, 4vw, 48px) / 1 | Section openers and page titles. |
| `t-title` | display | 20px / 26px | Panel titles, job names. |
| `t-body` | sans | 15px / 24px | Default reading text. Everything is mono; the rhythm comes from leading. |
| `t-body-s` | sans | 13px / 20px | Timestamps, captions, helper text. |
| `t-label` | sans | 12px / 16px | Eyebrows and column heads. Caps through CSS. |
| `t-numeral` | mono | 40px / 44px | KPI figures. Tabular. |
| `t-log` | mono | 13px / 20px | Log lines and commands. Prefixed by a prompt glyph, never a box. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
