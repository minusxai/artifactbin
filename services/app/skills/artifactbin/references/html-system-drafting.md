---
name: html-system-drafting
description: Native HTML tokens, typography and composition for Drafting, generated from its retained specification.
---
## Read first

**Drafting: Every line is a measurement.** Plans, specs, explainers, process stories. Technical; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="drafting" data-af-dark="false">`. Copy the installed `design-systems/drafting.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-vellum` | #eeede6 | #0f1b2d |
| `--ds-vellum-raised` | #f7f6f1 | #15253d |
| `--ds-vellum-sunk` | #e3e1d7 | #0a1322 |
| `--ds-grid` | #d9d7cc | #1f3350 |
| `--ds-ink` | #16181c | #e9eef7 |
| `--ds-ink-muted` | #4a4f58 | #9fb0c8 |
| `--ds-cobalt` | #2a5bd7 | #8fb4ff |
| `--ds-on-cobalt` | #ffffff | #0a1322 |
| `--ds-cobalt-soft` | #dfe7fb | #1b2f55 |
| `--ds-vermilion` | #ff781f | #ff9747 |
| `--ds-on-vermilion` | #16181c | #16181c |
| `--ds-vermilion-ink` | #963b00 | #ffaf6b |
| `--ds-vermilion-soft` | #ffd4b5 | #3b2413 |
| `--ds-positive` | #1f7a4d | #6fd49a |
| `--ds-positive-soft` | #dcefe3 | #113426 |
| `--ds-caution` | #685500 | #ffe83d |
| `--ds-caution-soft` | #ffe83d | #343b0f |
| `--ds-negative` | #c2320a | #ff7a4d |
| `--ds-negative-soft` | #ffe0d6 | #3b1a10 |

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
