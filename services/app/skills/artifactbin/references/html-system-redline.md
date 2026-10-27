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

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-paper` | #EEEADE | #20201D | Page ground and the paper slide surface. |
| `--ds-paper-raised` | #F6F3EA | #2A2A26 | Cards, fields, the paper stage inside an ink page. |
| `--ds-paper-sunk` | #E2DDCC | #171715 | Wells, tracks, table stripes, off dots. |
| `--ds-line` | #C9C3B0 | #3D3D37 | Hairline rules: list rows, footers, the slide foot. |
| `--ds-ink` | #20201D | #EEEADE | Type, rules, the ink slide surface, the ink half of the split bar. |
| `--ds-ink-soft` | #5C5A52 | #B3B0A3 | Secondary text, captions, muted eyebrows. |
| `--ds-on-ink` | #EEEADE | #20201D | Type on an ink surface. |
| `--ds-red` | #F04E38 | #F04E38 | The one colour. The red slide surface, the primary button, the accent half of a bar, the on dots. Unchanged in Night. |
| `--ds-on-red` | #20201D | #20201D | Type on red: ink, never paper, so red surfaces stay printed, not glowing. |
| `--ds-red-ink` | #B42D1C | #FF6A55 | Red as text on paper: one word in a headline, a link, a delta. |
| `--ds-red-soft` | #F9D5CF | #4A1D17 | Ground for selected rows and red callouts; text on it is ink. |
| `--ds-positive` | #2A9D5C | #5EC98A | Up, done, approved. Always with a word or a glyph. |
| `--ds-positive-soft` | #D7EFE0 | #143524 | Ground for success callouts. |
| `--ds-caution` | #B8841A | #F0BD57 | Pending, waiting, at capacity. |
| `--ds-caution-soft` | #FAECC9 | #42310A | Ground for warning callouts. |
| `--ds-negative` | #F04E38 | #F04E38 | Down, failed, refused. The same red: errors are loud, there is one red. |
| `--ds-negative-soft` | #F9D5CF | #4A1D17 | Ground for error callouts. |

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
