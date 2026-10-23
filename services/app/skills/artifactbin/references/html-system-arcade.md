---
name: html-system-arcade
description: Native HTML tokens, typography and composition for Arcade, generated from its retained specification.
---
## Read first

**Arcade: Insert coin. Press start. Have fun.** Games, launches, leaderboards, playful dashboards, teaching. Fun; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="arcade" data-af-dark="false">`. Copy the installed `design-systems/arcade.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-ground` | #f7f3e8 | #0a0a14 |
| `--ds-raised` | #ffffff | #141428 |
| `--ds-sunk` | #e9e3d3 | #050509 |
| `--ds-line` | #c9c2b0 | #26263d |
| `--ds-ink` | #0f0f1a | #f2f0ff |
| `--ds-ink-muted` | #5b586b | #9c98be |
| `--ds-red` | #ff3b3b | #ff5c5c |
| `--ds-on-red` | #ffffff | #0a0a14 |
| `--ds-blue` | #2e6bff | #5c8bff |
| `--ds-on-blue` | #ffffff | #0a0a14 |
| `--ds-blue-soft` | #dce6ff | #15224d |
| `--ds-yellow` | #ffd60a | #ffe34d |
| `--ds-on-yellow` | #0f0f1a | #0f0f1a |
| `--ds-magenta` | #ff4fd8 | #ff6ee0 |
| `--ds-cyan` | #35e0ff | #5ce8ff |
| `--ds-positive` | #13a03f | #2bd34a |
| `--ds-positive-soft` | #d4f5dd | #0d3a1c |
| `--ds-caution` | #c98a00 | #ffd60a |
| `--ds-caution-soft` | #fff1b8 | #3a2e05 |
| `--ds-negative` | #e02b2b | #ff5c5c |
| `--ds-negative-soft` | #ffd9d9 | #3d0f14 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(22px, 3.4vw, 44px) / 1.4 | One per page, three words at most. Press Start 2P is huge per point; 44px is the ceiling. |
| `t-display-l` | display | clamp(15px, 2vw, 26px) / 1.5 | Section openers. |
| `t-title` | sans | 26px / 30px | Card, panel and dialogue titles. Pixelify Sans bold. |
| `t-body` | sans | 18px / 26px | Reading and UI text. Pixelify Sans at 18px reads cleanly and still looks like a game. |
| `t-body-s` | sans | 15px / 20px | Captions, helper text, the small print. |
| `t-label` | display | 10px / 16px | Eyebrows, HUD labels, column heads, tags. Press Start 2P at 10px. |
| `t-numeral` | mono | 56px / 52px | Scores and counts. VT323, zero-padded, tabular, big. |
| `t-combo` | sans | 48px / 48px | The multiplier and the one celebratory word. Pixelify bold italic in red or yellow. |
| `t-mono` | mono | 22px / 26px | HUD rows, logs, dialogue. VT323 at 22px. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
