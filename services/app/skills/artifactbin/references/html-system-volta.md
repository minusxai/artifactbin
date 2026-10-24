---
name: html-system-volta
description: Native HTML tokens, typography and composition for Volta, generated from its retained specification.
---
## Read first

**Volta: Loud where it counts. Quiet everywhere else.** Data products, dashboards, launch pages. Loud; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="volta" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/volta.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/volta.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-paper` | #f3eee4 | #121110 |
| `--ds-paper-raised` | #fbf8f2 | #1c1a18 |
| `--ds-paper-sunk` | #e7dfcf | #0a0908 |
| `--ds-line` | #d3c9b5 | #34302a |
| `--ds-edge` | #14110f | #f3eee4 |
| `--ds-ink` | #14110f | #f3eee4 |
| `--ds-ink-muted` | #5a5348 | #a69e90 |
| `--ds-volt` | #ff4d1a | #ff5f2e |
| `--ds-on-volt` | #14110f | #14110f |
| `--ds-volt-ink` | #b5300a | #ff8a63 |
| `--ds-volt-soft` | #ffd9cb | #3d1a0f |
| `--ds-acid` | #d6f43a | #d6f43a |
| `--ds-on-acid` | #14110f | #14110f |
| `--ds-cobalt` | #2236d1 | #7484ff |
| `--ds-on-cobalt` | #ffffff | #0a0908 |
| `--ds-cobalt-soft` | #dde1ff | #161c45 |
| `--ds-positive` | #16683f | #5fd394 |
| `--ds-positive-soft` | #d5efdf | #0f2a1c |
| `--ds-caution` | #7d5900 | #f2c14e |
| `--ds-caution-soft` | #fbedc4 | #2e2405 |
| `--ds-negative` | #b5300a | #ff8a63 |
| `--ds-negative-soft` | #ffd9cb | #3d1a0f |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(56px, 9vw, 112px) / .9 | One per page, at most. Hero headlines and covers. |
| `t-display-l` | display | clamp(36px, 5vw, 60px) / .95 | Section openers, empty-state headlines. |
| `t-display-m` | display | 40px / 40px | Page titles. |
| `t-title` | display | 22px / 28px | Card and dialog titles. |
| `t-body-l` | sans | 18px / 28px | Lead paragraphs. |
| `t-body` | sans | 15px / 22px | Default UI and reading text. |
| `t-body-s` | sans | 13px / 18px | Captions, helper text, dense table cells. |
| `t-label` | sans | 12px / 16px | Eyebrows, tab labels, tag text. Caps come from CSS, never the copy. |
| `t-numeral` | mono | 40px / 44px | Numeric KPI figures. Tabular by nature: digits never jump. For prose KPI values, use a text role such as t-title or t-body, rather than the large mono numeral. |
| `t-mono` | mono | 13px / 20px | Code, SQL, IDs, table numbers. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
