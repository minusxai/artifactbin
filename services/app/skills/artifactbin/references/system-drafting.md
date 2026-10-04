---
name: system-drafting
kind: data
description: >-
  Drafting, a design system for artifactbin: Every line is a measurement. Technical; for plans, specs, explainers, process stories. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Drafting.** A drawing set, not a document. Drafting treats every page as a numbered sheet from an engineering drawing set: a gridded vellum, a frame, a title block, and the subject drawn in line-work with its dimensions. The reader is handed something measured. Cobalt annotates; vermilion marks the revision.

- **Use it for:** Implementation plans, specs and RFCs, process explainers, product teardowns, scroll stories where one object comes apart or goes together.
- **Avoid it when:** Warm or emotional subjects, consumer marketing, dashboards that need many simultaneous status colours, or any page whose reader is not expected to inspect.
- **Fit:** Dashboard good · Deck good · Editorial best · Scrolly best · Plan best · App avoid · Landing good.
- **Fonts:** Archivo · Archivo Narrow · IBM Plex Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: drafting`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Drafting · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-cobalt: #0a7f5a; } .dark { --ds-cobalt: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(48px, 8vw, 104px)/.9 · 900 | One per sheet. Poster-weight Archivo in caps; the subject as a title block. |
| `t-display-l` | display · clamp(32px, 4.5vw, 56px)/.95 · 900 | Section openers, sheet titles. |
| `t-title` | display · 22px/26px · 700 | Panel titles, figure titles. |
| `t-body` | sans · 16px/26px · 400 | Reading text. Archivo at a wide leading reads like a spec, not a brochure. |
| `t-body-s` | sans · 13px/19px · 400 | Notes, captions, helper text. |
| `t-label` | narrow · 12px/16px · 700 | Eyebrows, figure numbers, title-block cells. Archivo Narrow in caps. |
| `t-dim` | mono · 13px/18px · 500 | Dimension figures on drawings and in tables. Tabular. |
| `t-numeral` | mono · 40px/44px · 500 | KPI figures and allocations. |
| `t-mono` | mono · 13px/20px · 400 | Code, paths, API contracts. |

## Colour

Day is a cool grey-white vellum with a visible grid. Night is the same sheet as a blueprint: Prussian ground, pale line-work, cobalt lifted to sky-blue and vermilion warmed. Status colours are for ledgers and tables, never for the drawing itself.

| Token | Use |
|---|---|
| `--ds-vellum` | Page ground: cool drafting vellum by day, Prussian blueprint by night. |
| `--ds-vellum-raised` | Sheets, panels, fields. |
| `--ds-vellum-sunk` | Wells, code, title-block cells. |
| `--ds-grid` | The 24px drafting grid and hairline rules. Visible, never loud. |
| `--ds-ink` | Line-work and primary text. 1px for construction, 2px for the object. |
| `--ds-ink-muted` | Secondary text, dimension figures, notes. |
| `--ds-cobalt` | The annotation colour: dimensions, leaders, links, the primary action. |
| `--ds-on-cobalt` | Text on cobalt fills. |
| `--ds-cobalt-soft` | Ground for selected rows and info notes. |
| `--ds-vermilion` | The revision colour: what changed, what is wrong, the one highlighted part. |
| `--ds-on-vermilion` | Text on vermilion fills. |
| `--ds-vermilion-soft` | Ground for revision clouds and error notes. |
| `--ds-positive` | Verified, passed, released. Always with a word. |
| `--ds-positive-soft` | Ground for verified rows. |
| `--ds-caution` | Assumed, pending review. |
| `--ds-caution-soft` | Ground for assumptions. |
| `--ds-negative` | Failed, blocked. Shares vermilion in Night. |
| `--ds-negative-soft` | Ground for failures. |

Chart series order: cobalt, vermilion, ink, positive, ink-muted. Cobalt is the measured series; vermilion is the exception or the revision; ink is the baseline. Charts in Drafting look like figures: axis lines in ink, grid in the grid token, direct labels in the dim role.

## Components

Kit components take Drafting through the contract: square, 1px edges, cobalt primary, vellum grounds. Authored classes add the title-block cells, the dimension figures and the revision marks.

- **Buttons.** Kit buttons left; authored d-btn right: 1px ink frame, Archivo Narrow caps, cobalt primary. The revision button is vermilion and appears once per sheet at most.
- **Tags.** Tags are title-block cells: Archivo Narrow caps in a 1px frame. State tags say the state in a word.
- **Fields.** Fields are framed cells with the label in the title-block role above. Focus is a cobalt outline; there is no glow and no fill change.
- **Stat.** A Stat is a dimension: label above, mono numeral, the source or state below. Stats sit in a row of framed cells sharing their borders, like a title block.
- **Callouts.** Callouts are numbered notes in the margin. Assumptions take caution; revisions take vermilion; information takes cobalt.
- **Chart.** Charts are figures: ink axes, grid in the grid token, cobalt for the measured series, vermilion for the exception. Give every figure a Fig. number in the label role.
- **Table.** Tables are bills of materials: narrow caps headers, mono figures right-aligned, 1px grid rules. Never striped.
- **Card.** A card is a sheet: framed, with a title block along its bottom edge carrying number, sheet, scale and revision. Hover turns the frame cobalt.

```jsx
<Button>Book slot</Button><Button variant="secondary">Save draft</Button><Button variant="outline">Export sheet</Button><Button variant="ghost">Cancel</Button><button className="d-btn d-btn-primary">Book slot</button><button className="d-btn">Export sheet</button><button className="d-btn d-btn-rev">Mark revision</button>
<Badge>Cobalt</Badge><Badge variant="secondary">Selected</Badge><Badge variant="outline">Draft</Badge><Badge variant="destructive">Blocked</Badge><span className="d-tag">REV B</span><span className="d-tag d-tag-ok">VERIFIED</span><span className="d-tag d-tag-assume">ASSUMED</span><span className="d-tag d-tag-rev">CHANGED</span>
<div className="d-stat"><span className="t-label">Returned units</span><span className="t-numeral"><Number data="$totals" col="total" /></span><span className="d-note">batch RW-0417</span></div><div className="d-stat"><span className="t-label">Back in use</span><span className="t-numeral"><Number data="$totals" col="reuse" /></span><span className="d-note d-ok">verified · 60%</span></div>
<Alert><AlertTitle>Slot already booked</AlertTitle><AlertDescription>Pick another hour or another machine.</AlertDescription></Alert><div className="d-note-box d-note-info"><strong>Note 3.</strong> Dimensions in millimetres. Tolerance ±0.5 unless stated.</div><div className="d-note-box d-note-assume"><strong>Assumed.</strong> Equipment ids are stable across the migration. Verify before task 4.</div><div className="d-note-box d-note-rev"><strong>REV B.</strong> Cancel now requires the booking owner; anonymous cancel removed.</div>
<div className="d-sheet"><div className="d-sheet-body"><p className="t-label">Fig. 02 · Booking flow</p><h3 className="t-title">One slot per machine per hour</h3><p className="d-sheet-p">The API reserves the row with a unique index on (machine, hour). A second request gets 409 and the UI offers the next free hour.</p></div><div className="d-titleblock"><span><b>DWG</b> BN-007</span><span><b>SHEET</b> 2/7</span><span><b>SCALE</b> NTS</span><span><b>REV</b> B</span></div></div>
```

Classes the runtime provides: `d-paper`, `d-grid`, `d-frame`, `d-ink2`, `d-ink1`, `d-block`, `d-dim`, `d-ext`, `d-arrow`, `d-lead`, `d-dim-t`, `d-blk-t`, `d-rev`, `d-rev-t`, `d-rev-l`, `d-muted`, `d-vermilion`, `d-ok`, `d-btn`, `d-btn-primary`, `d-btn-rev`, `d-tag`, `d-tag-ok`, `d-tag-assume`, `d-tag-rev`, `d-stat`, `d-note-box`, `d-note-info`, `d-note-assume`, `d-note-rev`, `d-sheet`, `d-sheet-body`, `d-sheet-p`, `d-titleblock`, `h-ink`, `h-outline-fill`, `h-num`, `h-text`, `h-fill`, `h-fill2`.

## The hand

Line-work, dimensioned, on the grid. Drafting draws the subject the way a drawing set would: the object in 1.5px ink line-work with square caps, nothing filled, construction at 1px, and cobalt only for the dimension or the one part being measured. Vermilion marks the revision. A drawing without a figure attached to it is unfinished.

| Rule | How |
|---|---|
| Stroke | 1.5px ink for the object, square caps and mitred joins. 1px grid lines for construction. |
| Fill | None. Cobalt as an outline marks the measured part; vermilion marks the revised one. |
| Shadow | None. A sheet lies flat. |
| Texture | The 24px grid behind every drawing. |
| Figures | Dimension figures in the mono dim role, attached with a 1px cobalt leader and closed arrowheads. |
| Motion | Lines draw in (stroke-dashoffset, 600ms ease-out) on first reveal; exploded parts translate along their axis. |

Drawing mode `outline`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-split-a`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Drafting draws with the apparatus of a drawing set. Put the data on the drawing: a count becomes a dimension, a share becomes a section, a change becomes a cloud.

- **The dimension line.** A measured figure attached to its object with a 1px cobalt line and 8px closed arrowheads, the figure in the dim role above the line. Use it for counts, widths, durations.
- **The revision cloud.** A scalloped vermilion outline around the region that changed since the last revision, with a REV tag. One cloud per sheet; if everything changed, the sheet is new.
- **The title block.** A framed strip of cells at the bottom of every sheet: drawing number, title, sheet x/y, scale, revision, date. Reading the title blocks reads the plan.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · good

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Classes the specimen uses: `ds-tpl-dash`, `ds-tpl-bar`, `ds-tpl-brand`, `t-label`, `ds-tpl-crumb`, `ds-tpl-bar-end`, `ds-tpl-kpis`, `ds-tpl-kpi`, `t-numeral`, `ds-tpl-delta`, `ds-tpl-dash-grid`, `ds-tpl-tile`.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · best

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.

```jsx
<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">Spec · Section 3</p>
  <h3 className="t-display-l ds-tpl-ed-h">How a booking is refused</h3>
  <p className="ds-tpl-deck">A partial unique index on (equipment, slot) is the whole concurrency story. The second request to arrive gets a 409 and the next free hour. Here is the sequence, dimensioned.</p>
  <p className="t-label ds-tpl-byline">Drawn by the platform team · Rev B · 2 Oct 2026</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">T</span>wo requests for the same slot arrive within twenty milliseconds. Both pass the availability check, because the check reads a snapshot. Both attempt the insert. The index admits one row; the second insert fails with a unique violation that the API translates into a 409 and a suggestion. The user who lost never sees a success message that is later withdrawn.</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n"><Number data="$totals" col="total" /></span><span className="t-label">Units inspected</span></div>
  </div>
</div>
```

### Scrolly · best

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand.

```jsx
<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps"><div className="ds-tpl-step"><span className="t-label">01</span><h4 className="t-title">A batch of 100 units arrives.</h4><p>Each square is one unit, drawn in plan. Inspection sorts them into three paths within a shift.</p></div><div className="ds-tpl-step"><span className="t-label">02</span><h4 className="t-title">Three paths, dimensioned.</h4><p>Sixty go back into service, twenty-five are opened for parts, fifteen are recycled. Every count is a dimension on the sheet.</p></div></div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">{/* draw this screen in the hand */}</div><p className="t-label ds-tpl-figure-cap">Fig. 1 · One batch of 100, by path · figures illustrative</p></div>
</div>
```

### Plan · best

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows.

```jsx
<div className="ds-tpl ds-tpl-plan">
  <div className="ds-tpl-plan-head"><p className="t-label ds-tpl-kicker">UI plan · Review draft</p><h3 className="t-display-m ds-tpl-plan-h">Onboarding: from sign-in to first value</h3>
    <div className="ds-tpl-plan-brief"><div><span className="t-label">Outcome</span><p>A new workspace reaches its first real result in under ten minutes, on desktop and phone, without a support call.</p></div><div><span className="t-label">Scope</span><p>Sign-in, workspace setup, first import, first result. Out: billing, invites, SSO.</p></div><div><span className="t-label">Status</span><p>Plan only · 2 of 6 tasks done · nothing verified in production</p></div></div></div>
  <p className="t-label ds-tpl-plan-sub">01 · Proposed screens</p>
  <div className="ds-tpl-wires"><div className="ds-tpl-wire ds-tpl-wire-desk">{/* draw this screen in the hand */}</div><div className="ds-tpl-wire">{/* draw this screen in the hand */}</div></div>
  <p className="ds-tpl-wire-cap">S1 desktop keeps the rail and the stat row beside the chart; S1 mobile stacks the stat above the rows and moves the primary action to the bottom.</p>
  <p className="t-label ds-tpl-plan-sub">02 · Transitions</p>
  <div className="ds-tpl-flow"><Mermaid title="Screen transitions" code={`flowchart LR
  A((Sign in)) -->|Continue| B[S1 Overview]
  B -->|Import| C{Rows parse?}
  C -->|Yes| D[S2 First result]
  C -->|No| E[S2e Fix columns]
  E -->|Retry| C
  D -->|Share| F((Done))`} /></div>
  <p className="t-label ds-tpl-plan-sub">03 · Decisions</p>
  <div className="ds-tpl-decisions"><div className="ds-tpl-decision"><h4 className="t-title">Import before invite.</h4><p>A first result alone beats an empty workspace with teammates in it. Invites move to S3.</p></div><div className="ds-tpl-decision"><h4 className="t-title">One primary action per screen.</h4><p>Continue, Import, Share. Everything else is a link.</p></div><div className="ds-tpl-decision"><h4 className="t-title">Errors keep the data.</h4><p>A failed parse shows the columns it could not read and keeps the file; the user never re-uploads.</p></div></div>
  <p className="t-label ds-tpl-plan-sub">04 · Execution ledger</p>
  <table className="ds-tpl-ledger"><thead><tr><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody><tr><td><s>Wireframes S1–S2 reviewed</s></td><td>Design</td><td><span className="ds-tpl-tag is-ok">Done</span></td></tr><tr><td><s>Import parser handles quoted commas</s></td><td>Platform</td><td><span className="ds-tpl-tag is-ok">Done</span></td></tr><tr><td>S2e fix-columns screen</td><td>App</td><td><span className="ds-tpl-tag is-warn">In progress</span></td></tr><tr><td>Mobile bottom action bar</td><td>App</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr><tr><td>First-result empty state copy</td><td>Content</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr><tr><td>Verify on a 390px viewport</td><td>QA</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr></tbody></table>
  <p className="ds-tpl-wire-cap">Done means: a fresh account reaches S2 with real data in under ten minutes on a phone, and the S2e branch recovers without a re-upload.</p>
</div>
```

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Warm or emotional subjects, consumer marketing, dashboards that need many simultaneous status colours, or any page whose reader is not expected to inspect.

### Landing · good

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Classes the specimen uses: `ds-tpl-landing`, `ds-tpl-hero`, `ds-tpl-hero-words`, `t-label`, `ds-tpl-kicker`, `t-display-xl`, `ds-tpl-hero-h`, `ds-tpl-hero-sub`, `ds-row`, `d-btn`, `d-btn-primary`, `ds-tpl-hero-art`, `h-ground`, `h-muted`, `h-ink`, `h-fill`, `h-outline-fill`, `h-fill2`, `h-num`, `h-text`, `ds-tpl-feats`, `ds-tpl-feat`, `t-title`.

## Do and don't

- Draw the subject in ink line-work and attach every figure with a dimension line.
- Frame every sheet and give it a title block.
- Cobalt for annotation, vermilion for the one revision.
- Snap to the 24px grid; let it show.

Don't:

- No photographs as the hero; no rounded corners; no shadows.
- No status colour on the drawing itself.
- No floating numbers; a figure without a leader is a rumour.
- No more than one revision cloud per sheet.

## What has no slot

The grid texture, the dimension and arrowhead styles, the title block and the revision cloud have no contract slot; they are d-* classes and inline SVG. Kit tables take the grid rules and mono figures but not the narrow caps header.
