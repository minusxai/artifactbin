---
name: html-system-broadsheet
description: Native HTML tokens, typography and composition for Broadsheet, generated from its retained specification.
---
## Read first

**Broadsheet: Set it like it happened.** Features, reports, newsletters, long reads. Editorial; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="broadsheet" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/broadsheet.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/broadsheet.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-newsprint` | #f6efe0 | #141210 |
| `--ds-newsprint-raised` | #fbf6ea | #1d1a16 |
| `--ds-newsprint-sunk` | #ebe2cd | #0e0c0a |
| `--ds-line` | #cfc3a6 | #3a342b |
| `--ds-ink` | #1f1b16 | #efe6d2 |
| `--ds-ink-muted` | #5c5345 | #ada28b |
| `--ds-red` | #b8371f | #ff6a4d |
| `--ds-on-red` | #f6efe0 | #141210 |
| `--ds-red-soft` | #f3dcd5 | #3a1812 |
| `--ds-positive` | #2f6b3a | #8ed29a |
| `--ds-positive-soft` | #dcebd8 | #15301b |
| `--ds-caution` | #8a5a00 | #f2c14e |
| `--ds-caution-soft` | #f3e5c0 | #332508 |
| `--ds-negative` | #b8371f | #ff6a4d |
| `--ds-negative-soft` | #f3dcd5 | #3a1812 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-masthead` | masthead | clamp(40px, 7vw, 84px) / 1 | The masthead, once, centred, between a double rule. Blackletter is for the name only. |
| `t-display-xl` | display | clamp(44px, 6.5vw, 80px) / 1 | The headline. Old Standard bold; the second line may carry the one red word. |
| `t-display-l` | display | clamp(30px, 4vw, 48px) / 1.08 | Section heads and crossheads. |
| `t-deck` | display | clamp(19px, 2.2vw, 24px) / 1.35 | The deck under the headline. Italic Old Standard. |
| `t-body` | sans | 17px / 27px | Body text, in columns where the width allows. A drop cap opens the piece. |
| `t-small` | franklin | 11px / 15px | Datelines, figure labels, folios, the small print. Franklin caps. |
| `t-numeral` | display | clamp(44px, 6vw, 72px) / .95 | Pull figures, set large in the margin with a Franklin caption. |
| `t-wire` | mono | 13px / 20px | Wire copy, tables of figures, datelines in the old style. Courier Prime. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
