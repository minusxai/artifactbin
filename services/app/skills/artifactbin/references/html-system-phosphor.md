---
name: html-system-phosphor
description: Native HTML tokens, typography and composition for Phosphor, generated from its retained specification.
---
## Read first

**Phosphor: Green text. Black glass. No lies.** Dev tools, CI, logs, status pages. Technical; opens dark.

## Bind ordinary HTML

Set `<html data-af-design-system="phosphor" data-af-dark="true">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/phosphor.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/phosphor.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-glass` | #f2f5ec | #060a06 | Page ground. Black glass in Night; a printout in Paper. |
| `--ds-glass-raised` | #fbfcf7 | #0c130c | Panels, fields, menus. |
| `--ds-glass-sunk` | #e3e9d9 | #030503 | Log wells, code, inactive tracks. |
| `--ds-line` | #c9d3bf | #1b2a1b | Hairline rules between log lines and table rows. |
| `--ds-edge` | #0f7a3a | #3dff7a | The 1px outline on controls and panels. In Night it is the phosphor itself. |
| `--ds-ink` | #0f1f12 | #d7ffe0 | Primary text. Pale green-white in Night so the glow has somewhere to go. |
| `--ds-ink-muted` | #4c6b52 | #7fb48f | Secondary text, timestamps, dimmed log lines. |
| `--ds-green` | #0f7a3a | #3dff7a | The brand and the pass state. Primary actions, the prompt, the cursor. |
| `--ds-on-green` | #f2f5ec | #04140a | Text on green fills. |
| `--ds-green-ink` | #0b6a31 | #5fff93 | Green as text: links, the active line. |
| `--ds-green-soft` | #d9f0dc | #0f2a18 | Ground for pass rows and selected lines. |
| `--ds-amber` | #9a6a00 | #ffb000 | The attention colour: focus ring, warnings, the one thing running now. |
| `--ds-on-amber` | #1a1000 | #1a1000 | Text on amber fills. |
| `--ds-amber-soft` | #f6e9c4 | #2a1e00 | Ground for warning rows. |
| `--ds-positive` | #0f7a3a | #3dff7a | Pass. Shares green: in Phosphor, green means it worked. |
| `--ds-caution` | #9a6a00 | #ffb000 | Flaky, pending, retrying. |
| `--ds-negative` | #b3261e | #ff5c5c | Fail. The only red on the screen. |
| `--ds-negative-soft` | #f6d9d6 | #2d0e0e | Ground for failed rows and error callouts. |
| `--ds-cyan` | #0b6e7a | #5ee1f0 | Second chart series and the diff-added colour. Never for state. |
| `--ds-violet` | #5b3fb0 | #b79cff | Third chart series. |

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
