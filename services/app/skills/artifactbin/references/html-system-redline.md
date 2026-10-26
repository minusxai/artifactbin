---
name: html-system-redline
description: Native HTML tokens, typography and composition for Redline, generated from its retained specification.
---
## Read first

**Redline: One word. Then the number.** Slides, decision briefs, launch pages, posters. Poster; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="redline" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/redline.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/redline.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-paper` | #EEEADE | #20201D |
| `--ds-paper-raised` | #F6F3EA | #2A2A26 |
| `--ds-paper-sunk` | #E2DDCC | #171715 |
| `--ds-line` | #C9C3B0 | #3D3D37 |
| `--ds-ink` | #20201D | #EEEADE |
| `--ds-ink-soft` | #5C5A52 | #B3B0A3 |
| `--ds-on-ink` | #EEEADE | #20201D |
| `--ds-red` | #EC402B | #EC402B |
| `--ds-on-red` | #20201D | #20201D |
| `--ds-red-ink` | #B42D1C | #FF6A55 |
| `--ds-red-soft` | #F9D5CF | #4A1D17 |
| `--ds-positive` | #2A9D5C | #5EC98A |
| `--ds-positive-soft` | #D7EFE0 | #143524 |
| `--ds-caution` | #B8841A | #F0BD57 |
| `--ds-caution-soft` | #FAECC9 | #42310A |
| `--ds-negative` | #EC402B | #EC402B |
| `--ds-negative-soft` | #F9D5CF | #4A1D17 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(80px, 18vw, 240px) / .82 | The cover word. One per deck or page; it may run off the stage. |
| `t-display-l` | display | clamp(48px, 7.5vw, 104px) / .9 | Slide titles and section openers. |
| `t-display-m` | display | 44px / 40px | Page titles, big labels beside a number. |
| `t-title` | display | 24px / 26px | Card titles, list heads, feature titles. |
| `t-body-l` | sans | 19px / 1.5 | Decks and the one sentence under a number. |
| `t-body` | sans | 16px / 1.55 | Reading and interface text. |
| `t-body-s` | sans | 13px / 18px | Captions, sources, the slide foot. |
| `t-label` | mono | 11px / 16px | Eyebrows, toplines, list numbers, stamp text. Mono caps through CSS. |
| `t-numeral` | display | 64px / 56px | KPI figures and the giant slide number. Condensed, tabular. |
| `t-mono` | mono | 13px / 20px | Code, ratios, list figures. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
