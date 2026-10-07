---
name: system-signout
kind: data
description: >-
  Signout, a design system for artifactbin: Pick a machine. Pick an hour. Sign the sheet. Utilitarian; for booking apps, intake forms, rosters, inventories. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Signout.** The sheet on the wall, made clickable. Signout is the clipboard sign-out sheet every shared workshop has: kraft paper, a marker-black grid, hazard tape along the top, hatching where someone else has already signed, a stamp when you have. It makes a booking tool feel like a thing you can put your hand on, and it keeps the state honest: open, yours, or taken.

- **Use it for:** Booking and reservation apps, intake and sign-up forms, rosters and shift sheets, inventories and loan logs, any tool where people claim slots or things.
- **Avoid it when:** Reading-heavy pages, luxury or editorial subjects, dashboards with many simultaneous metrics, or anything that needs to feel soft.
- **Fit:** Dashboard good · Deck avoid · Editorial avoid · Scrolly avoid · Plan good · App best · Landing avoid.
- **Fonts:** Barlow Condensed · Barlow · JetBrains Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: signout`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container text-foreground">`, then kit components, token classes and the classes below. Keep layout wrappers transparent: the runtime paints the system's page ground, including textures. Use an opaque surface only for a deliberate panel or section; a blanket `bg-background` hides that ground.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Signout · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-vermilion: #0a7f5a; } .dark { --ds-vermilion: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(56px, 9vw, 120px)/.86 · 800 | One per sheet. Barlow Condensed at 800 in caps: a marker on kraft. |
| `t-display-l` | display · clamp(36px, 5vw, 64px)/.9 · 800 | Section and panel titles. |
| `t-display-m` | display · 28px/28px · 700 | Row titles: the machine, the person, the item. |
| `t-body` | sans · 16px/24px · 400 | Instructions and reading text. Barlow, plain. |
| `t-body-s` | sans · 13px/18px · 400 | Specs, captions, helper text. |
| `t-label` | display · 12px/14px · 700 | Column heads, slot labels, stamps. Condensed caps. |
| `t-numeral` | mono · 36px/40px · 600 | Counts: open slots, members, hours. Mono, tabular. |
| `t-mono` | mono · 13px/20px · 400 | Booking ids, times, the shop log. |

## Colour

Day is the paper: clean kraft with marker-black ink and a hot vermilion pick. Night is the chalkboard: green-black ground, chalk-white ink, the vermilion lifted, the hazard tape unchanged. Taken slots are hatched in ink (or chalk) in both modes; they never take a colour.

| Token | Use |
|---|---|
| `--ds-kraft` | Page ground: kraft paper by day; the chalkboard at night. |
| `--ds-kraft-raised` | Sheets, slots, fields. |
| `--ds-kraft-sunk` | Wells, column heads, code. |
| `--ds-line` | Hairline rules; the grid of the sheet; the hatch. |
| `--ds-ink` | Marker by day, chalk by night: all text, the 2px grid, the stamp outline. |
| `--ds-ink-muted` | Secondary text, timestamps, the small print. |
| `--ds-vermilion` | The pick: your slot, the primary action, the stamp. One per view. |
| `--ds-on-vermilion` | Text on vermilion fills. |
| `--ds-vermilion-soft` | Ground for the selected row and the picked slot halo. |
| `--ds-hazard` | Hazard tape: the top stripe, warnings, the thing that needs care. Text on it is ink. |
| `--ds-hazard-soft` | Ground for warnings. |
| `--ds-caution` | Warnings as text: hazard darkened on kraft, the tape itself on the chalkboard. |
| `--ds-open` | Open, available, confirmed: the stamp green. Always with a word. |
| `--ds-open-soft` | Ground for confirmed bookings. |
| `--ds-booked` | Signed out by someone else: hatched, never red. |
| `--ds-negative` | Failed, overdue, broken. |
| `--ds-negative-soft` | Ground for failures. |

Chart series order: ink, vermilion, hazard, open, ink-muted. Charts are marker drawings: ink first, vermilion for the exception, hazard for the warning. Utilisation is better shown as a filled grid than as a bar chart.

## Components

Kit components take Signout through the contract: kraft grounds, vermilion primary, zero radius, line rules. Authored classes add the sheet frame, the slot cells, the hatch and the stamp.

- **Buttons.** Kit buttons left; authored so-btn right: Condensed caps in a 2px frame; the primary is vermilion; the hazard variant is for actions that affect someone else.
- **Tags.** Tags are condensed caps in a 1px frame. Open is outlined, yours is vermilion, taken is hatched. The stamp is the receipt.
- **Fields.** Fields are cells on the sheet: a 2px ink rule below, Condensed caps label above. Focus is a vermilion outline inside the cell.
- **Stat.** A Stat is a count on the sheet: label, a mono numeral with its denominator, the small print. The vermilion Stat is yours.
- **Callouts.** Callouts are notes clipped to the sheet: a bold lead word, one sentence of action. Hazard for care, open for confirmations, negative for overdue.
- **Chart.** Charts in Signout are mostly grids. When a bar chart is right, ink first, vermilion for yours, hazard for the warning.
- **Table.** Tables are the shop log: mono times, Condensed caps headers, 1px rules, a state tag at the end. Overdue rows take negative-soft.
- **Card.** A card is a sheet: hazard tape, a title, the grid of cells in their three states, and the small print. This is the whole app in one component.

```jsx
<Button>Sign out</Button><Button variant="secondary">Hold</Button><Button variant="outline">Return</Button><Button variant="ghost">Cancel</Button><button className="so-btn so-btn-primary">Sign out</button><button className="so-btn">Return</button><button className="so-btn so-btn-haz">Release slot</button>
<Badge>Yours</Badge><Badge variant="secondary">Held</Badge><Badge variant="outline">Open</Badge><Badge variant="destructive">Overdue</Badge><span className="so-tag so-tag-open">Open</span><span className="so-tag so-tag-pick">Your pick</span><span className="so-tag so-tag-taken">Signed out</span><span className="so-stamp-i">Booked</span>
<div className="so-stat"><span className="t-label">Open slots</span><span className="t-numeral"><Number data="$totals" col="open" /><span className="so-of">/<Number data="$totals" col="slots" /></span></span><span className="so-small">Sat 03 Oct · three machines</span></div><div className="so-stat so-stat-pick"><span className="t-label">Yours</span><span className="t-numeral"><Number data="$totals" col="mine" /></span><span className="so-small">#0417 · 11:00 drill press</span></div>
<Alert><AlertTitle>Slot already signed out</AlertTitle><AlertDescription>R. Okafor has the sewing machine at 11:00. Pick 10:00 or noon.</AlertDescription></Alert><div className="so-note so-note-haz"><strong>Read before you sign.</strong> The soldering station needs the extractor on; the switch is behind the bench.</div><div className="so-note so-note-open"><strong>Booked.</strong> Drill press, Sat 03 Oct, 11:00–11:50. It is on your sheet.</div><div className="so-note so-note-neg"><strong>Overdue.</strong> The sewing machine was due back at 11:50. Return it or extend before 12:00.</div>
<div className="so-sheet"><div className="so-sheet-haz"></div><div className="so-sheet-body"><p className="t-label">Sheet 01 · Saturday 03 October</p><h3 className="t-display-l">Pick a machine. Pick an hour.</h3><div className="so-grid"><div className="so-cell so-head">Machine</div><div className="so-cell so-head">10:00</div><div className="so-cell so-head">11:00</div><div className="so-cell so-head">12:00</div><div className="so-cell so-row-h"><span className="t-display-m">Drill press</span><span className="so-small">Clausing 2286 · 15&quot; floor</span></div><div className="so-cell so-open">Open</div><div className="so-cell so-pick">Your pick</div><div className="so-cell so-open">Open</div><div className="so-cell so-row-h"><span className="t-display-m">Sewing machine</span><span className="so-small">Juki DDL-8700 · industrial</span></div><div className="so-cell so-open">Open</div><div className="so-cell so-taken"><span>Signed out</span><span className="so-small">R. Okafor</span></div><div className="so-cell so-open">Open</div><div className="so-cell so-row-h"><span className="t-display-m">Soldering station</span><span className="so-small">Hakko FX-951 · with extractor</span></div><div className="so-cell so-open">Open</div><div className="so-cell so-open">Open</div><div className="so-cell so-open">Open</div></div><p className="so-small so-sheet-foot">Prototype · all data synthetic · no real accounts</p></div></div>
```

Classes the runtime provides: `so-kraft`, `so-haz`, `so-haz-f`, `so-haz-ink`, `so-cond`, `so-cond-s`, `so-blk`, `so-muted-f`, `so-on-pick`, `so-on-hatch`, `so-rule2`, `so-grid`, `so-cell-f`, `so-frame`, `so-hatch`, `so-pick`, `so-stamp`, `so-stamp-t`, `so-muted`, `so-vermilion`, `so-btn`, `so-btn-primary`, `so-btn-haz`, `so-tag`, `so-tag-open`, `so-tag-pick`, `so-tag-taken`, `so-stamp-i`, `so-stat`, `so-stat-pick`, `t-label`, `so-small`, `so-of`, `so-note`, `so-note-haz`, `so-note-open`, `so-note-neg`, `so-sheet`, `so-sheet-haz`, `so-sheet-body`, `so-sheet-foot`, `so-cell`, `so-row-h`, `t-display-m`, `so-head`, `so-open`, `so-taken`, `so-legend`, `so-leg`, `so-leg-pick`, `so-leg-taken`, `so-meta-row`, `so-num-s`, `so-steps`, `so-step`, `so-step-on`, `so-side`, `so-panel`, `so-panel-h`, `so-empty`, `h-text`, `h-num`, `h-tex-fill2`.

## The hand

A marker, a ruler, and hatching for everything filled. Signout draws the way a sheet on the wall is drawn: 2px marker lines with square caps, no fills except hatching. The pick is hatched in vermilion, the taken parts in ink, and the quiet parts stay kraft. No shadows, no curves that a ruler could not make.

| Rule | How |
|---|---|
| Stroke | 2px ink, square caps and joins. Every edge is ruled. |
| Fill | None. A filled region is hatched at 45°, 6px pitch: vermilion for the pick, ink for taken. |
| Shadow | None. The sheet is pinned flat. |
| Texture | The hatch is the only texture; the hazard chevron is the only ornament. |
| Figures | Condensed caps for the number; mono caps at 11px for labels. |
| Motion | A drawing never moves. A stamp lands on it. |

Drawing mode `hatch`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hand-tex`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Signout draws with what is on the workshop wall. The data lives in the cells: a slot is open, yours or hatched; a warning is tape; a confirmation is a stamp.

- **The hatch.** 45° ink lines at an 8px pitch, clipped to the cell. It means taken by someone else. Never use a colour for this state; the hatch reads at any size and in both modes.
- **The hazard stripe.** Yellow and ink chevrons along the top edge of anything that needs reading before acting: a sheet, a warning, a destructive button. 10px tall, never animated by default.
- **The stamp.** A rotated 2px box with Condensed caps: SIGNED OUT, RETURNED, BOOKED. It is the receipt; it lands once and stays.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · good

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Classes the specimen uses: `ds-tpl-dash`, `ds-tpl-bar`, `ds-tpl-brand`, `t-label`, `ds-tpl-crumb`, `ds-tpl-bar-end`, `ds-tpl-kpis`, `ds-tpl-kpi`, `t-numeral`, `ds-tpl-delta`, `ds-tpl-dash-grid`, `ds-tpl-tile`.

### Deck · avoid

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Expect custom CSS: Reading-heavy pages, luxury or editorial subjects, dashboards with many simultaneous metrics, or anything that needs to feel soft.

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Reading-heavy pages, luxury or editorial subjects, dashboards with many simultaneous metrics, or anything that needs to feel soft.

### Scrolly · avoid

Template: scrolly. Chapters and their figures stay in ordinary document flow; the author supplies each chapter’s figure state and the system owns the step card and figure, drawn in its hand. Expect custom CSS: Reading-heavy pages, luxury or editorial subjects, dashboards with many simultaneous metrics, or anything that needs to feel soft.

### Plan · good

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Classes the specimen uses: `ds-tpl-plan`, `ds-tpl-plan-head`, `t-label`, `ds-tpl-kicker`, `t-display-m`, `ds-tpl-plan-h`, `ds-tpl-plan-brief`, `ds-tpl-plan-sub`, `ds-tpl-wires`, `ds-tpl-wire`, `ds-tpl-wire-desk`, `h-ground`, `h-muted`, `h-tex`, `h-tex-fill`, `h-tex-fill2`, `h-ink`, `h-text`, `ds-tpl-wire-cap`, `ds-tpl-flow`, `ds-tpl-decisions`, `ds-tpl-decision`, `t-title`, `ds-tpl-ledger`, `ds-tpl-tag`, `is-ok`, `is-warn`, `is-idle`.

### App · best

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.

```jsx
<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Toolroom</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="Member number" value="$pick" /><button className="so-btn so-btn-primary">Sign out</button></div></div>
  <div className="ds-tpl-rows"><div className="ds-tpl-row"><span className="ds-tpl-row-name">Drill press</span><span className="ds-tpl-row-meta">Clausing 2286 · 15" floor</span><span className="ds-tpl-tag is-ok">Open</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Sewing machine</span><span className="ds-tpl-row-meta">Juki DDL-8700 · industrial</span><span className="ds-tpl-tag is-warn">Taken 11:00</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Soldering station</span><span className="ds-tpl-row-meta">Hakko FX-951 · extractor off</span><span className="ds-tpl-tag is-bad">Overdue</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Laser cutter</span><span className="ds-tpl-row-meta">Needs induction</span><span className="ds-tpl-tag is-idle">Not yet</span></div></div>
  <div className="ds-tpl-form"><Select label="Machine" value="$pick" options={["Choose", "Review", "Booked"]} /><Switch label="Show past bookings" checked="$flag" /><button className="so-btn">Return</button></div>
</div>
```

### Landing · avoid

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Expect custom CSS: Reading-heavy pages, luxury or editorial subjects, dashboards with many simultaneous metrics, or anything that needs to feel soft.

## Do and don't

- Three states: open blank, yours vermilion, taken hatched.
- Frame every sheet in 2px ink and put hazard tape where care is needed.
- Condensed caps for titles and labels; plain Barlow for instructions.
- Stamp confirmations; log everything with a time.

Don't:

- No colour for the taken state; hatch it.
- No rounded corners, shadows or gradients.
- No second accent; hazard is a warning, not a brand.
- No empty state that says "nothing here" without saying what to do.

## What has no slot

The hatch, the hazard stripe, the stamp and the sheet grid have no contract slot; they are so-* classes and inline SVG. Kit tables take the rules and mono figures but not the condensed caps header.
