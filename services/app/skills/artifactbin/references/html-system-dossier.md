---
name: html-system-dossier
description: Native HTML tokens, typography and composition for Dossier, generated from its retained specification.
---
## Read first

**Dossier: Say what you know, and how you know it.** Plans, reports, post-mortems, long features. Evidential; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="dossier" data-af-dark="false">`. Copy the installed `design-systems/dossier.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-paper` | #F3EEE1 | #0D0B19 |
| `--ds-paper-raised` | #FBF8F0 | #16141F |
| `--ds-paper-sunk` | #E9E2D0 | #07060C |
| `--ds-line` | #D6CEBB | #2B2838 |
| `--ds-ink` | #12101C | #ECE6D6 |
| `--ds-ink-soft` | #4A4658 | #A9A3B8 |
| `--ds-night` | #0D0B19 | #F3EEE1 |
| `--ds-on-night` | #ECE6D6 | #12101C |
| `--ds-night-muted` | #A9A3B8 | #4A4658 |
| `--ds-violet` | #3A1CF0 | #8F7BFF |
| `--ds-on-violet` | #FFFFFF | #0D0B19 |
| `--ds-violet-soft` | #DCD6FB | #231B55 |
| `--ds-lime` | #D6FF3C | #D6FF3C |
| `--ds-on-lime` | #12101C | #12101C |
| `--ds-positive` | #1E7B4F | #5FCF93 |
| `--ds-positive-soft` | #D8EEE0 | #0F3022 |
| `--ds-caution` | #B7791F | #F0B64A |
| `--ds-caution-soft` | #FBEBC9 | #3A2A08 |
| `--ds-negative` | #C62828 | #FF7A6E |
| `--ds-negative-soft` | #FAD9D5 | #431512 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(64px, 12vw, 160px) / .8 | One per page. The cover word, set condensed and enormous; the second line may be violet. |
| `t-display-l` | display | clamp(40px, 6.5vw, 88px) / .84 | Section heads, paired with the inverted number block. |
| `t-display-m` | display | 36px / 36px | Page titles, slide titles. |
| `t-title` | display | 20px / 24px | Card titles, row heads, the stamp word. |
| `t-body-l` | sans | 21px / 1.4 | Ledes and decks, in Newsreader. |
| `t-body` | sans | 18px / 1.56 | Reading text. Newsreader at 18 with a 62ch measure. |
| `t-body-ui` | ui | 15px / 22px | Interface text: forms, tables, lists, callouts. Archivo at normal width. |
| `t-body-s` | ui | 13px / 18px | Captions, helper text, dense cells. |
| `t-label` | mono | 11px / 16px | Eyebrows, tags, column heads, footers. Mono caps through CSS. |
| `t-numeral` | display | 48px / 48px | Facts-rail figures and KPIs. Condensed, tabular. |
| `t-mono` | mono | 13px / 20px | Code, SQL, identifiers, ledger figures. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
