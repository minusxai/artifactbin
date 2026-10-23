---
name: html-system-almanac
description: Native HTML tokens, typography and composition for Almanac, generated from its retained specification.
---
## Read first

**Almanac: Warm paper, one green ink, one terracotta word.** Scrolly explainers, landing pages, long reads, annual reports. Warm; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="almanac" data-af-dark="false">`. Copy the installed `design-systems/almanac.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-paper` | #F2E7D6 | #1B241B |
| `--ds-card` | #F8F1E6 | #243024 |
| `--ds-band` | #E7CFB4 | #2E3B2E |
| `--ds-screen` | #C8D1A9 | #3A4A36 |
| `--ds-paper-sunk` | #E8DBC6 | #141B14 |
| `--ds-line` | #CBBFA9 | #3C4A3C |
| `--ds-ink` | #374836 | #F2E7D6 |
| `--ds-ink-muted` | #6B7A69 | #A9B5A6 |
| `--ds-accent` | #B44E30 | #E07A58 |
| `--ds-on-accent` | #F2E7D6 | #1B241B |
| `--ds-accent-soft` | #F0D9CD | #4A2A1E |
| `--ds-mauve` | #846B94 | #B7A3C4 |
| `--ds-positive` | #3E6B3C | #8FC28C |
| `--ds-positive-soft` | #DCE6C9 | #263A26 |
| `--ds-caution` | #8C6A1E | #E0B65A |
| `--ds-caution-soft` | #F3E5BE | #3E3218 |
| `--ds-negative` | #B44E30 | #E07A58 |
| `--ds-negative-soft` | #F0D9CD | #4A2A1E |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(64px, 10.4vw, 160px) / .92 | One per page. Instrument Serif at 400 with the tracking pulled tight; the italic carries the emphasised word. |
| `t-display-l` | display | clamp(40px, 5.5vw, 78px) / .98 | Section openers and chapter heads. |
| `t-display-m` | display | 40px / 42px | Card titles and page titles. |
| `t-title` | sans | 24px / 1.2 | Sub-heads inside steps and features. |
| `t-numeral-xl` | display | clamp(72px, 9vw, 120px) / 1 | The outcome numbers. Instrument Serif, tracked to -.07em, one per block. |
| `t-body-l` | sans | 18px / 1.7 | Step paragraphs and lead copy at a generous 1.7 leading. |
| `t-body` | sans | 16px / 1.6 | Default reading and UI text. |
| `t-body-s` | sans | 13px / 1.5 | Captions, notes, footer lines. |
| `t-label` | mono | 11px / 1.6 | Eyebrows, nav links, legends, chapter numbers. Caps from CSS. |
| `t-numeral` | display | 48px / 1 | KPI figures in tiles and tickets. |
| `t-mono` | mono | 12px / 1.6 | Code, IDs, table figures. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
