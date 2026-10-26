---
name: html-system-meridian
description: Native HTML tokens, typography and composition for Meridian, generated from its retained specification.
---
## Read first

**Meridian: Quiet surfaces. One blue. Nothing to forgive.** Product dashboards, docs, SaaS marketing. Sleek, Professional; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="meridian" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/meridian.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/meridian.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-canvas` | #f4f4f5 | #0b0c0f |
| `--ds-surface` | #ffffff | #14161b |
| `--ds-surface-sunk` | #eeeef0 | #1c1f26 |
| `--ds-hairline` | #e4e4e7 | #262a33 |
| `--ds-hairline-strong` | #c9c9ce | #3a3f4b |
| `--ds-ink` | #111114 | #f2f2f4 |
| `--ds-ink-soft` | #5a5b63 | #a0a3ad |
| `--ds-ink-faint` | #696a73 | #848894 |
| `--ds-blue` | #2e5bff | #7a9bff |
| `--ds-on-blue` | #ffffff | #0b0c0f |
| `--ds-blue-soft` | #e9eeff | #182040 |
| `--ds-blue-ink` | #2449d0 | #9db5ff |
| `--ds-positive` | #15803d | #4ade80 |
| `--ds-positive-soft` | #e6f6ec | #0f2a1a |
| `--ds-caution` | #a16207 | #facc15 |
| `--ds-caution-soft` | #fdf4d8 | #2d2408 |
| `--ds-negative` | #dc2626 | #f87171 |
| `--ds-negative-soft` | #fde8e8 | #2f1313 |
| `--ds-violet` | #7c5cff | #a78bfa |
| `--ds-teal` | #0d9488 | #2dd4bf |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(48px, 7vw, 96px) / .98 | One per page. Hero headlines. Semibold, never bold: the presence comes from size and tracking, not weight. |
| `t-display-l` | display | clamp(32px, 4.2vw, 52px) / 1.04 | Section openers. |
| `t-display-m` | display | 28px / 32px | Page titles. |
| `t-title` | display | 16px / 22px | Card titles, dialog titles, table group heads. |
| `t-body-l` | sans | 18px / 28px | Lead paragraphs and marketing copy. |
| `t-body` | sans | 14px / 22px | Default UI and reading text. 14px: product density, not a blog. |
| `t-body-s` | sans | 13px / 18px | Captions, helper text, dense cells. |
| `t-label` | sans | 12px / 16px | Field labels, column heads, stat labels. Medium weight, sentence case: Meridian never shouts. |
| `t-eyebrow` | mono | 12px / 16px | Section eyebrows and breadcrumbs in the mono, with a dot. The only place the mono appears outside code. |
| `t-numeral` | sans | 36px / 40px | KPI figures in the sans, tabular, with the unit set smaller beside them. Mono is for code, not for money. |
| `t-mono` | mono | 13px / 20px | Code, paths, IDs, keyboard keys. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
