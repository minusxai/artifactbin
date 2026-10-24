---
name: html-system-sorbet
description: Native HTML tokens, typography and composition for Sorbet, generated from its retained specification.
---
## Read first

**Sorbet: Candy colours, plum ink, one spring.** Consumer apps, launches, kids and food, celebrations, playful data. Fun; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="sorbet" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/sorbet.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/sorbet.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-cream` | #fff9f2 | #221433 |
| `--ds-cream-raised` | #ffffff | #2e1c45 |
| `--ds-cream-sunk` | #ffefe3 | #1a0f29 |
| `--ds-line` | #f0d9d0 | #45306a |
| `--ds-ink` | #2b1b3d | #fff4f8 |
| `--ds-ink-muted` | #6e5a80 | #c9b6d9 |
| `--ds-rim` | #ffffff | #2e1c45 |
| `--ds-strawberry` | #ff5c8a | #ff6e98 |
| `--ds-on-strawberry` | #2b1b3d | #2b1b3d |
| `--ds-strawberry-soft` | #ffe1ea | #4a2340 |
| `--ds-mango` | #ffb01f | #ffbb3d |
| `--ds-lime` | #8be04d | #9beb5e |
| `--ds-blueberry` | #5b7cff | #7a95ff |
| `--ds-on-blueberry` | #ffffff | #120a1f |
| `--ds-grape` | #b96cff | #c78aff |
| `--ds-lilac` | #eadff5 | #3b2a55 |
| `--ds-positive` | #3e8a14 | #9beb5e |
| `--ds-positive-soft` | #e6f8d6 | #213a14 |
| `--ds-caution` | #9a5e00 | #ffbb3d |
| `--ds-caution-soft` | #fff0cc | #3d2b08 |
| `--ds-negative` | #c2185b | #ff6e98 |
| `--ds-negative-soft` | #ffe1ea | #4a2340 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(48px, 8vw, 104px) / .95 | One per page. Fredoka bold; one word may sit on a sticker. |
| `t-display-l` | display | clamp(32px, 4.5vw, 56px) / 1.02 | Section openers. |
| `t-title` | display | 24px / 28px | Card titles, sticker words. |
| `t-body` | sans | 17px / 27px | Reading and UI text. Nunito, round and soft. |
| `t-body-s` | sans | 14px / 20px | Captions and helper text. |
| `t-label` | display | 12px / 16px | Eyebrows, tags, sticker text. Fredoka caps. |
| `t-numeral` | display | 52px / 52px | Counts and prices. Fredoka bold, tabular. |
| `t-mono` | mono | 13px / 20px | Ticket numbers, timestamps, receipts. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
