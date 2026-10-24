---
name: html-system-riso
description: Native HTML tokens, typography and composition for Riso, generated from its retained specification.
---
## Read first

**Riso: Three inks, one key plate, a hair out of register.** Scrolly stories, picture-book explainers, posters, zines. Printed; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="riso" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/riso.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/riso.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-paper` | #F3ECDC | #1C2340 |
| `--ds-sheet` | #FBF6EA | #263054 |
| `--ds-paper-sunk` | #E8DFC6 | #151b33 |
| `--ds-manila` | #F1DFA6 | #F1DFA6 |
| `--ds-line` | #CFC5AD | #3A4470 |
| `--ds-key` | #1C2340 | #F3ECDC |
| `--ds-key-2` | #3A3F5C | #B9BED6 |
| `--ds-blue` | #0078BF | #2E9BE8 |
| `--ds-on-blue` | #FBF6EA | #1C2340 |
| `--ds-blue-soft` | #CFE6F5 | #173555 |
| `--ds-pink` | #FF48B0 | #FF48B0 |
| `--ds-on-pink` | #1C2340 | #1C2340 |
| `--ds-pink-soft` | #FFD3EA | #4A1E3A |
| `--ds-yellow` | #FFE800 | #FFE800 |
| `--ds-on-yellow` | #1C2340 | #1C2340 |
| `--ds-positive` | #00875A | #2FD27E |
| `--ds-positive-soft` | #CDEEDD | #0F3A26 |
| `--ds-caution` | #8A6D00 | #FFE800 |
| `--ds-caution-soft` | #FFF3A0 | #3A3400 |
| `--ds-negative` | #E8322B | #FF6B61 |
| `--ds-negative-soft` | #FFD6D3 | #4A1512 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(64px, 12vw, 160px) / .82 | One per page. The chapter word, the cover word. Soft, wonky, enormous. |
| `t-display-l` | display | clamp(40px, 6.4vw, 84px) / .9 | Section openers and plate titles. |
| `t-display-m` | display | 40px / 40px | Tag titles, stat blocks, page titles. |
| `t-title` | display | 24px / 28px | Card and step titles. |
| `t-deck` | display | clamp(20px, 2vw, 26px) / 1.25 | The italic line under a headline, chapter subtitles, pull quotes. |
| `t-body-l` | sans | 20px / 1.5 | Step cards and lead paragraphs. Fraunces at 500 reads at length. |
| `t-body` | sans | 17px / 1.55 | Default reading and UI text. |
| `t-body-s` | sans | 14px / 1.45 | Captions, imprints, helper text. |
| `t-label` | mono | 12px / 16px | Eyebrows, folios, tag facts, running heads. Caps from CSS. |
| `t-numeral` | mono | 40px / 44px | KPI figures and the numbers inside doors. Tabular. |
| `t-mono` | mono | 13px / 20px | Code, IDs, table figures. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
