---
name: html-system-signout
description: Native HTML tokens, typography and composition for Signout, generated from its retained specification.
---
## Read first

**Signout: Pick a machine. Pick an hour. Sign the sheet.** Booking apps, intake forms, rosters, inventories. Utilitarian; opens light.

## Bind ordinary HTML

Set `<html data-af-design-system="signout" data-af-dark="false">`. Keep the installed `design-systems/` and `fonts/` folders together under the project root. Link `<link data-af="design-system" rel="stylesheet" href="./design-systems/signout.css">` from a page at that root. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. Pages in a subfolder must adjust the stylesheet link, for example `../design-systems/signout.css`. There is no theme metadata or automatic kit stylesheet.

Use normal `class="t-title"` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces use the included pinned WOFF2 files through stylesheet-relative URLs; private preview, publication bundles and offline Save preserve those exact bytes without a font service. If you inline this CSS, rewrite every `../fonts/` URL relative to the HTML file and include those files in the project. A downloaded page never includes account credentials.

## Color and typography

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ds-kraft` | #f3ecdc | #14201a | Page ground: kraft paper by day; the chalkboard at night. |
| `--ds-kraft-raised` | #faf6ec | #1b2a22 | Sheets, slots, fields. |
| `--ds-kraft-sunk` | #e8dfca | #0e1712 | Wells, column heads, code. |
| `--ds-line` | #c9bc9c | #35493d | Hairline rules; the grid of the sheet; the hatch. |
| `--ds-ink` | #16140f | #ede6d6 | Marker by day, chalk by night: all text, the 2px grid, the stamp outline. |
| `--ds-ink-muted` | #5b5344 | #a9b3a4 | Secondary text, timestamps, the small print. |
| `--ds-vermilion` | #e5481b | #ff6a3d | The pick: your slot, the primary action, the stamp. One per view. |
| `--ds-on-vermilion` | #16140f | #16140f | Text on vermilion fills. |
| `--ds-vermilion-soft` | #f9d9cc | #3a1d14 | Ground for the selected row and the picked slot halo. |
| `--ds-hazard` | #f2b705 | #f2b705 | Hazard tape: the top stripe, warnings, the thing that needs care. Text on it is ink. |
| `--ds-hazard-soft` | #f8ecc0 | #3a2f08 | Ground for warnings. |
| `--ds-caution` | #7a5a00 | #f2b705 | Warnings as text: hazard darkened on kraft, the tape itself on the chalkboard. |
| `--ds-open` | #1f7a4d | #7fd99f | Open, available, confirmed: the stamp green. Always with a word. |
| `--ds-open-soft` | #d9ebdf | #17352a | Ground for confirmed bookings. |
| `--ds-booked` | #5b5344 | #a9b3a4 | Signed out by someone else: hatched, never red. |
| `--ds-negative` | #b3261e | #ff6a5a | Failed, overdue, broken. |
| `--ds-negative-soft` | #f3d4d0 | #3a1a14 | Ground for failures. |

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
