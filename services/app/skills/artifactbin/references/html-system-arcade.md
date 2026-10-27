---
name: html-system-arcade
description: Native HTML tokens, typography and composition for Arcade, generated from its retained specification.
---
## Read first

**Arcade: Insert coin. Press start. Have fun.** Games, launches, leaderboards, playful dashboards, teaching. Fun; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="arcade" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/arcade.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/arcade.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-ground` | #f7f3e8 | #0a0a14 | Page ground: near-white cabinet by day; the CRT black by night (with scanlines). |
| `--ds-raised` | #ffffff | #141428 | Panels, cards, the dialogue box. |
| `--ds-sunk` | #e9e3d3 | #050509 | Wells, the checker squares, empty HP blocks. |
| `--ds-line` | #c9c2b0 | #26263d | Hairline rules; the checker contrast. |
| `--ds-ink` | #0f0f1a | #f2f0ff | Pixel ink: text, sprites, every 4px frame. |
| `--ds-ink-muted` | #5b586b | #9c98be | Secondary text, the dim high score. |
| `--ds-red` | #ff3b3b | #ff5c5c | The brand: cabinet red. Primary actions, hearts, the player sprite. |
| `--ds-on-red` | #ffffff | #0a0a14 | Text on red fills. |
| `--ds-blue` | #2e6bff | #5c8bff | Player two: the second drawing fill, the first chart series, links. |
| `--ds-on-blue` | #ffffff | #0a0a14 | Text on blue fills. |
| `--ds-blue-soft` | #dce6ff | #15224d | Ground for the selected row and the quiet drawing fill. |
| `--ds-yellow` | #ffd60a | #ffe34d | The coin: points, the highlighted figure, the focus ring, the star. |
| `--ds-on-yellow` | #0f0f1a | #0f0f1a | Text on yellow fills. |
| `--ds-magenta` | #ff4fd8 | #ff6ee0 | Bonus items and the fourth chart series. Never a status. |
| `--ds-cyan` | #35e0ff | #5ce8ff | Shields, power-ups and the fifth chart series. Never a status. |
| `--ds-positive` | #13a03f | #2bd34a | HP full, pass, level up. The green blocks. Always with a glyph or a word. |
| `--ds-positive-soft` | #d4f5dd | #0d3a1c | Ground for pass rows and the level-up ribbon. |
| `--ds-caution` | #c98a00 | #ffd60a | HP half, low coins, a hint. The yellow blocks. |
| `--ds-caution-soft` | #fff1b8 | #3a2e05 | Ground for warnings. |
| `--ds-negative` | #e02b2b | #ff5c5c | HP low, fail, game over. The red blocks. |
| `--ds-negative-soft` | #ffd9d9 | #3d0f14 | Ground for fail rows. |

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
