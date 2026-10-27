---
name: html-system-drafting
description: Native HTML tokens, typography and composition for Drafting, generated from its retained specification.
---
## Read first

**Drafting: Every line is a measurement.** Plans, specs, explainers, process stories. Technical; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="drafting" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/drafting.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/drafting.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-vellum` | #eeede6 | #0f1b2d | Page ground: cool drafting vellum by day, Prussian blueprint by night. |
| `--ds-vellum-raised` | #f7f6f1 | #15253d | Sheets, panels, fields. |
| `--ds-vellum-sunk` | #e3e1d7 | #0a1322 | Wells, code, title-block cells. |
| `--ds-grid` | #d9d7cc | #1f3350 | 24px drafting grid and hairline rules. Page grids use this at half strength; readable blocks have solid vellum backgrounds. |
| `--ds-ink` | #16181c | #e9eef7 | Line-work and primary text. 1px for construction, 2px for the object. |
| `--ds-ink-muted` | #4a4f58 | #9fb0c8 | Secondary text, dimension figures, notes. |
| `--ds-cobalt` | #2a5bd7 | #8fb4ff | Hierarchy and annotation: headline emphasis, sheet numbers, dimensions, links and the primary action. |
| `--ds-on-cobalt` | #ffffff | #0a1322 | Text on cobalt fills. |
| `--ds-cobalt-soft` | #dfe7fb | #1b2f55 | Pale blue evidence panels, title blocks and selected regions of a drawing. |
| `--ds-vermilion` | #ff781f | #ff9747 | Fluorescent safety orange for revision fills, outlines and changed parts; use on-vermilion for text on the fill. |
| `--ds-on-vermilion` | #16181c | #16181c | Text on vermilion fills. |
| `--ds-vermilion-ink` | #963b00 | #ffaf6b | Readable orange ink for revision text on vellum and pale orange. |
| `--ds-vermilion-soft` | #ffd4b5 | #3b2413 | Warm orange ground for revision notes and changed regions. |
| `--ds-positive` | #1f7a4d | #6fd49a | Verified, passed, released. Always with a word. |
| `--ds-positive-soft` | #dcefe3 | #113426 | Ground for verified rows. |
| `--ds-caution` | #685500 | #ffe83d | Assumed, pending review. |
| `--ds-caution-soft` | #ffe83d | #343b0f | Warm fluorescent yellow for small assumption tags and short highlighted phrases; never a paragraph or full-width panel. |
| `--ds-negative` | #c2320a | #ff7a4d | Failed or blocked. Always pair with a word. |
| `--ds-negative-soft` | #ffe0d6 | #3b1a10 | Ground for failures. |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(48px, 8vw, 104px) / .9 | One per sheet. Poster-weight Archivo in caps; the subject as a title block. |
| `t-display-l` | display | clamp(32px, 4.5vw, 56px) / .95 | Section openers, sheet titles. |
| `t-title` | display | 22px / 26px | Panel titles, figure titles. |
| `t-body` | sans | 16px / 26px | Reading text. Archivo at a wide leading reads like a spec, not a brochure. |
| `t-body-s` | sans | 13px / 19px | Notes, captions, helper text. |
| `t-label` | narrow | 12px / 16px | Eyebrows, figure numbers, title-block cells. Archivo Narrow in caps. |
| `t-dim` | mono | 13px / 18px | Dimension figures on drawings and in tables. Tabular. |
| `t-numeral` | mono | 40px / 44px | KPI figures and allocations. |
| `t-mono` | mono | 13px / 20px | Code, paths, API contracts. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
