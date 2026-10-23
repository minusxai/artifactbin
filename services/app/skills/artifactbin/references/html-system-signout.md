---
name: html-system-signout
description: Native HTML tokens, typography and composition for Signout, generated from its retained specification.
---
## Read first

**Signout: Pick a machine. Pick an hour. Sign the sheet.** Booking apps, intake forms, rosters, inventories. Utilitarian; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="signout" data-af-dark="false">`. Copy the installed `design-systems/signout.css` into `<style data-af="design-system">` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark |
|---|---|---|
| `--ds-kraft` | #f3ecdc | #14201a |
| `--ds-kraft-raised` | #faf6ec | #1b2a22 |
| `--ds-kraft-sunk` | #e8dfca | #0e1712 |
| `--ds-line` | #c9bc9c | #35493d |
| `--ds-ink` | #16140f | #ede6d6 |
| `--ds-ink-muted` | #5b5344 | #a9b3a4 |
| `--ds-vermilion` | #e5481b | #ff6a3d |
| `--ds-on-vermilion` | #16140f | #16140f |
| `--ds-vermilion-soft` | #f9d9cc | #3a1d14 |
| `--ds-hazard` | #f2b705 | #f2b705 |
| `--ds-hazard-soft` | #f8ecc0 | #3a2f08 |
| `--ds-caution` | #7a5a00 | #f2b705 |
| `--ds-open` | #1f7a4d | #7fd99f |
| `--ds-open-soft` | #d9ebdf | #17352a |
| `--ds-booked` | #5b5344 | #a9b3a4 |
| `--ds-negative` | #b3261e | #ff6a5a |
| `--ds-negative-soft` | #f3d4d0 | #3a1a14 |

| Role | Family | Size / line height | Use |
|---|---|---|---|
| `t-display-xl` | display | clamp(56px, 9vw, 120px) / .86 | One per sheet. Barlow Condensed at 800 in caps: a marker on kraft. |
| `t-display-l` | display | clamp(36px, 5vw, 64px) / .9 | Section and panel titles. |
| `t-display-m` | display | 28px / 28px | Row titles: the machine, the person, the item. |
| `t-body` | sans | 16px / 24px | Instructions and reading text. Barlow, plain. |
| `t-body-s` | sans | 13px / 18px | Specs, captions, helper text. |
| `t-label` | display | 12px / 14px | Column heads, slot labels, stamps. Condensed caps. |
| `t-numeral` | mono | 36px / 40px | Counts: open slots, members, hours. Mono, tabular. |
| `t-mono` | mono | 13px / 20px | Booking ids, times, the shop log. |

## Compose and verify

Use this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.

Read [native design-system selection](html-design-systems.md) for the catalogue and binding limits.
