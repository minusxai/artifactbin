---
name: system-meridian
kind: data
description: >-
  Meridian, a design system for artifactbin: Quiet surfaces. One blue. Nothing to forgive. Sleek, Professional; for product dashboards, docs, saas marketing. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Meridian.** The product that gets out of the way. Meridian is the look of software confident enough to be quiet: a grey canvas, white surfaces that sit on it under a 1px top highlight, hairlines instead of shadows, 14px sans everywhere, and one blue used exactly once per view. At night the surfaces turn to glass with a gradient edge and a soft blue glow behind the hero. Nothing decorates; depth comes from layering, hierarchy from spacing and tracking, and the only coloured things are the data and the one action.

- **Use it for:** Product dashboards, settings and billing screens, developer and product docs, SaaS marketing pages, changelogs, anything a professional reads every day and should never notice the chrome of.
- **Avoid it when:** Editorial or narrative subjects, anything that wants warmth, print or texture, consumer brands with a personality to show, or a page whose job is to be remembered rather than used.
- **Fit:** Dashboard best · Deck good · Editorial good · Scrolly avoid · Plan best · App best · Landing best.
- **Fonts:** Geist · Geist Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: meridian`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Meridian · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-blue: #0a7f5a; } .dark { --ds-blue: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(48px, 7vw, 96px)/.98 · 600 | One per page. Hero headlines. Semibold, never bold: the presence comes from size and tracking, not weight. |
| `t-display-l` | display · clamp(32px, 4.2vw, 52px)/1.04 · 600 | Section openers. |
| `t-display-m` | display · 28px/32px · 600 | Page titles. |
| `t-title` | display · 16px/22px · 600 | Card titles, dialog titles, table group heads. |
| `t-body-l` | sans · 18px/28px · 400 | Lead paragraphs and marketing copy. |
| `t-body` | sans · 14px/22px · 400 | Default UI and reading text. 14px: product density, not a blog. |
| `t-body-s` | sans · 13px/18px · 400 | Captions, helper text, dense cells. |
| `t-label` | sans · 12px/16px · 500 | Field labels, column heads, stat labels. Medium weight, sentence case: Meridian never shouts. |
| `t-eyebrow` | mono · 12px/16px · 500 | Section eyebrows and breadcrumbs in the mono, with a dot. The only place the mono appears outside code. |
| `t-numeral` | sans · 36px/40px · 600 | KPI figures in the sans, tabular, with the unit set smaller beside them. Mono is for code, not for money. |
| `t-mono` | mono · 13px/20px · 400 | Code, paths, IDs, keyboard keys. |

## Colour

Day is a grey canvas with white surfaces; Night is near-black with surfaces one step lighter and a gradient edge. The hairline is the only structural colour. Blue carries action and focus; three status colours carry state and always come with a dot or a word. Violet and teal exist only for charts.

| Token | Use |
|---|---|
| `--ds-canvas` | Page ground. Visibly a step below the surfaces by day; true near-black by night. |
| `--ds-surface` | Cards, fields, menus, the rail. Separated from canvas by a hairline and a 1px top highlight, never a drop shadow. |
| `--ds-surface-sunk` | Code wells, table header, inactive tracks, the inside of a keyboard key, the row hover tint. |
| `--ds-hairline` | Every border. One weight, one colour, everywhere. |
| `--ds-hairline-strong` | Borders on hover, the active field, the table header rule, the top of a glass card. |
| `--ds-ink` | Primary text and icons. |
| `--ds-ink-soft` | Secondary text, labels, placeholders, captions. |
| `--ds-ink-faint` | Tertiary text: timestamps, helper text, disabled labels, the drawing line. |
| `--ds-blue` | The one colour. Primary actions, links, the focus ring, the first series. One fill per view. |
| `--ds-on-blue` | Text and icons on blue fills. |
| `--ds-blue-soft` | Tinted ground for the active nav item, selected rows, info callouts. |
| `--ds-blue-ink` | Blue as text: links, the active nav label, the selected tab. |
| `--ds-positive` | Success text and the up-delta. Always paired with a word or a dot. |
| `--ds-positive-soft` | Ground for success tags. |
| `--ds-caution` | Warnings and pending states. |
| `--ds-caution-soft` | Ground for warning tags. |
| `--ds-negative` | Errors, destructive actions, the down-delta. |
| `--ds-negative-soft` | Ground for error tags and callouts. |
| `--ds-violet` | Second chart series only. |
| `--ds-teal` | Third chart series only. |

Chart series order: blue, violet, teal, ink-faint, caution. Blue is the focal series; violet and teal exist only for charts so they never compete with action or status. The fourth series is grey. Gridlines are the hairline; the axis line is removed.

## Components

Meridian is close to the contract's native shape, so kit components arrive nearly finished: white surfaces, hairlines, 8px corners, a blue primary. The authored classes add the top highlight, the keycap, the status dot, the glass edge and the command palette.

- **Buttons.** Kit buttons left; authored me-btn right. The primary is blue with a 1px darker inset ring and a top highlight; the secondary is a white surface with a hairline that strengthens on hover; the ghost has no border until hover. A key chip inside the primary shows its shortcut.
- **Tags.** Status tags are a 6px dot plus a word in sentence case on a soft ground. The dot is the colour; the word is the meaning. A live dot pulses.
- **Fields.** Fields are white surfaces with a hairline; the label sits above in the label role and helper text below in ink-faint. Focus swaps the hairline for the blue ring.
- **Stat.** A stat is a label, a sans numeral and a delta. Stats share one card and are separated by hairlines, never boxed individually. The delta is the only coloured text.
- **Callouts.** A callout is a hairline box with a 2px left rule in the status colour. The ground stays white except for errors, which take the soft red.
- **Chart.** Charts take blue first and violet second with no area fills. Gridlines are the hairline; the axis line is removed; labels are ink-soft at 12px.
- **Table.** Tables are the densest thing in Meridian: 12px padding, hairline rows, a sunk header with a hairline-strong rule, tabular figures right-aligned, initials avatars beside names. No zebra stripes; hover tints the row by one step.
- **Card.** A glass card: a white surface inside a 1px gradient edge that brightens at the top. The metric row (label, a 4px track, the figure) shows a quantity inside a card without a chart. The keyboard hint sits in the footer.

```jsx
<Button>Create invoice</Button><Button variant="secondary">Duplicate</Button><Button variant="outline">Export</Button><Button variant="ghost">Cancel</Button><button className="me-btn me-btn-primary">Create invoice <kbd className="me-kbd me-kbd-on">⌘N</kbd></button><button className="me-btn">Export CSV</button><button className="me-btn me-btn-ghost">Cancel</button><button className="me-btn me-btn-danger">Delete</button>
<Badge>Active</Badge><Badge variant="secondary">Trial</Badge><Badge variant="outline">Draft</Badge><Badge variant="destructive">Past due</Badge><span className="me-tag me-tag-ok"><i></i>Paid</span><span className="me-tag me-tag-warn"><i></i>Pending</span><span className="me-tag me-tag-bad"><i></i>Failed</span><span className="me-tag"><i></i>Draft</span><span className="me-tag me-tag-ok me-tag-live"><i></i>Live</span>
<div className="me-stat-card ds-stats-card"><div className="me-stat"><span className="t-label">Monthly recurring revenue</span><span className="t-numeral"><Number data="$totals" col="mrr" prefix="$" format=",.0f" /></span><span className="me-delta me-up">↑ 12.4% vs last month</span></div><div className="me-stat"><span className="t-label">Active subscriptions</span><span className="t-numeral"><Number data="$totals" col="subs" format=",.0f" /></span><span className="me-delta">+84 this month</span></div></div>
<Alert><AlertTitle>Card declined</AlertTitle><AlertDescription>Update the payment method to keep the workspace active.</AlertDescription></Alert><div className="me-callout me-callout-info"><strong>Invoices settle in 3 days.</strong> Payouts arrive the following business day.</div><div className="me-callout me-callout-ok"><strong>Payment received.</strong> Invoice #1042 is paid in full.</div><div className="me-callout me-callout-bad"><strong>Webhook failed.</strong> Endpoint returned 502 three times; retrying in 10 minutes.</div>
<div className="me-glass"><div className="me-glass-in me-card-x"><div className="me-card-head"><span className="t-title">Usage this cycle</span><span className="me-tag me-tag-ok"><i></i>On track</span></div><div className="me-metric-row"><span>API requests</span><span className="me-bar-track"><span className="me-bar-fill" data-w="72"></span></span><span className="me-metric-n">7.2M / 10M</span></div><div className="me-metric-row"><span>Seats</span><span className="me-bar-track"><span className="me-bar-fill" data-w="60"></span></span><span className="me-metric-n">18 / 30</span></div><div className="me-metric-row"><span>Storage</span><span className="me-bar-track"><span className="me-bar-fill me-bar-warn" data-w="91"></span></span><span className="me-metric-n">91 GB / 100 GB</span></div><div className="me-card-foot"><button className="me-btn">Manage plan</button><span className="me-kbd-hint">Press <kbd className="me-kbd">⌘</kbd><kbd className="me-kbd">K</kbd> to search</span></div></div></div>
```

Classes the runtime provides: `h-num`, `h-text`, `h-fill`, `h-outline-fill`, `h-fill2`, `me-ground`, `me-glow-a`, `me-glow-b`, `me-frame`, `me-card`, `me-surface`, `me-palette`, `me-shadow`, `me-dot`, `me-line-h`, `me-line-on`, `me-hair`, `me-hair-dash`, `me-active`, `me-avatar-sq`, `me-caret`, `me-pill-k`, `me-pill-kt`, `me-blue`, `me-blue-stroke`, `me-bar`, `me-track`, `me-warn`, `me-key`, `me-key-t`, `me-key-big`, `me-chip`, `me-chip-t`, `me-pill`, `me-pill-t`, `me-num`, `me-num-big`, `me-dot-ok`, `me-dot-warn`, `me-dot-bad`, `me-dot-ring`, `me-ge-a`, `me-ge-b`, `me-sh-a`, `me-sh-b`, `me-btn`, `me-btn-primary`, `me-btn-ghost`, `me-btn-danger`, `me-tag`, `me-tag-ok`, `me-tag-warn`, `me-tag-bad`, `me-tag-live`, `me-live`, `me-stat`, `me-stat-card`, `me-delta`, `me-up`, `me-down`, `me-callout`, `me-callout-info`, `me-callout-ok`, `me-callout-bad`, `me-glass`, `me-glass-in`, `me-card-x`, `me-card-head`, `me-metric-row`, `me-bar-track`, `me-bar-fill`, `me-bar-warn`, `me-metric-n`, `me-card-foot`, `me-kbd-hint`, `me-kbd`, `me-kbd-on`, `me-faint`, `me-shell`, `me-rail`, `me-ws`, `me-ws-sq`, `me-ws-chev`, `me-nav`, `me-nav-item`, `me-nav-on`, `me-rail-foot`, `me-avatar`, `me-avatar-ini`, `me-main`, `me-topbar`, `me-crumbs`, `me-sep`, `me-crumb-on`, `me-search`, `me-head-sub`, `me-card-table`, `me-table`, `me-r`, `me-mono`, `me-cust`, `me-ini`, `me-dot-tag`, `me-dt-ok`, `me-dt-warn`, `me-dt-bad`, `me-activity`, `me-act-h`, `me-act`, `me-act-t`, `me-act-dot`, `me-act-ok`, `me-act-bad`, `me-act-blue`, `me-ws-name`.

## The hand

Thin grey lines, one blue shape, nothing filled. Meridian draws the way its docs draw: 1.5px lines in the faint ink with round caps, surfaces left white, exactly one shape in blue and the second role as a blue outline. No shadows, no texture, no hatching; the drawing should look like a figure from a well-made API reference.

| Rule | How |
|---|---|
| Stroke | 1.5px in ink-faint, round caps and joins. The drawing is quieter than the text around it. |
| Fill | None, except the one blue shape per drawing. The secondary role is a blue outline at 40%. |
| Shadow | None. A drawing sits on the surface like a diagram. |
| Texture | None. Quiet surfaces stay quiet. |
| Figures | Mono at 11px for labels, stroked with the surface so they stay legible on a fill; the sans numeral for the one number. |
| Motion | Lines draw in over 400ms on first reveal; nothing after that. |

Drawing mode `outline`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hand-text-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-h-size`, `--ds-slide-split-a`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Meridian's devices are the furniture of good software: the command palette, the keycap, the status dot, the glass edge, the shine divider and the metric row. Each is a hairline, a surface and at most one blue.

- **The command palette.** A floating surface with the only real shadow in the system: a search line, hairline-separated results, the selected row on blue-soft, a key chip per action. Use it as the hero device of any product page.
- **The keyboard key and the code chip.** A 6px keycap with a 2px inset bottom for shortcuts; a sunk chip with a 6px corner for versions, IDs, endpoints and paths. Mono at 12px; neither ever wraps or shouts.
- **The status dot.** A 6px dot in the status colour beside a word in sentence case. Live pulses; everything else holds still. A dot never appears without its word.
- **The glass edge.** A card is a surface inside a 1px gradient border that fades from hairline-strong at the top to the hairline at the bottom; at night it fades to nothing. The top catches light; the card sits on the canvas without a shadow.
- **The shine divider.** A hairline that brightens to blue across its middle fifth. Use it once, between the hero and the first section of a marketing page, or above a footer. Never between cards.
- **The metric row.** Label, a 4px track with a blue fill, the figure. Three to five rows replace a bar chart inside a card; the caution fill marks a quota near its limit.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · best

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours.

```jsx
<div className="ds-tpl ds-tpl-dash">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Meridian</span><span className="t-label ds-tpl-crumb">Billing · Overview</span><div className="ds-tpl-bar-end"><Segmented label="Window" value="$pick" options={["30 days", "90 days", "12 months"]} /></div></div>
  <div className="ds-tpl-kpis"><div className="ds-tpl-kpi"><span className="t-label">Monthly recurring revenue</span><span className="t-numeral"><Number data="$totals" col="mrr" prefix="$" format=",.0f" /></span><span className="ds-tpl-delta">↑ 12.4% vs last month</span></div><div className="ds-tpl-kpi"><span className="t-label">Active subscriptions</span><span className="t-numeral"><Number data="$totals" col="subs" format=",.0f" /></span><span className="ds-tpl-delta">+84 this month</span></div><div className="ds-tpl-kpi"><span className="t-label">Past due</span><span className="t-numeral"><Number data="$totals" col="past_due" prefix="$" format=",.0f" /></span><span className="ds-tpl-delta">↓ 6 invoices</span></div></div>
  <div className="ds-tpl-dash-grid">
    <div className="ds-tpl-tile"><span className="t-label">Revenue by plan</span><Question data="$series" height="240px" viz={{"kind": "vega-lite", "spec": {"mark": {"type": "line", "strokeWidth": 2}, "encoding": {"x": {"field": "month", "type": "ordinal", "title": null, "sort": ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]}, "y": {"field": "revenue", "type": "quantitative", "title": null}, "color": {"field": "plan", "type": "nominal", "title": "Plan"}}}}} /></div>
    <div className="ds-tpl-tile"><span className="t-label">Recent invoices</span><DataTable data="$table" rowKey="invoice" height="240px" columns={[{"col": "invoice", "title": "Invoice"}, {"col": "customer", "title": "Customer"}, {"col": "amount", "title": "Amount", "fmt": ",.0f", "align": "right"}, {"col": "status", "title": "Status"}]} /></div>
  </div>
</div>
```

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · good

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Classes the specimen uses: `ds-tpl-ed`, `t-label`, `ds-tpl-kicker`, `t-display-l`, `ds-tpl-ed-h`, `ds-tpl-deck`, `ds-tpl-byline`, `ds-tpl-ed-cols`, `ds-tpl-ed-body`, `ds-tpl-dropcap`, `ds-tpl-pull`, `t-numeral`, `ds-tpl-pull-n`.

### Scrolly · avoid

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Expect custom CSS: Editorial or narrative subjects, anything that wants warmth, print or texture, consumer brands with a personality to show, or a page whose job is to be remembered rather than used.

### Plan · best

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows.

```jsx
<div className="ds-tpl ds-tpl-plan">
  <div className="ds-tpl-plan-head"><p className="t-label ds-tpl-kicker">Product plan · Review draft</p><h3 className="t-display-m ds-tpl-plan-h">Usage-based billing: from meter to invoice</h3>
    <div className="ds-tpl-plan-brief"><div><span className="t-label">Outcome</span><p>A workspace can meter any event, see the running bill on S1 before the month closes, and receive a correct invoice on S2 with no manual adjustment.</p></div><div><span className="t-label">Scope</span><p>Meter ingestion, the running-bill screen (S1), the invoice preview (S2) and the parse-error recovery (S2e). Out: proration rules, credits, multi-currency.</p></div><div><span className="t-label">Status</span><p>Plan only · 2 of 6 tasks done · parser verified on fixtures, nothing in production</p></div></div></div>
  <p className="t-label ds-tpl-plan-sub">01 · Proposed screens</p>
  <div className="ds-tpl-wires"><div className="ds-tpl-wire ds-tpl-wire-desk">{/* draw this screen in the hand */}</div><div className="ds-tpl-wire">{/* draw this screen in the hand */}</div></div>
  <p className="ds-tpl-wire-cap">S1 desktop keeps the rail and the stat row beside the usage chart; S1 mobile stacks the running bill above the metered rows and moves "Preview invoice" to a bottom action.</p>
  <p className="t-label ds-tpl-plan-sub">02 · Transitions</p>
  <div className="ds-tpl-flow"><Mermaid title="Screen transitions · S1 → S2" code={`flowchart LR
  A((Meter events)) -->|Ingest| B[S1 Running bill]
  B -->|Preview invoice| C{Lines reconcile?}
  C -->|Yes| D[S2 Invoice preview]
  C -->|No| E[S2e Unmatched meters]
  E -->|Map and retry| C
  D -->|Issue| F((Invoice sent))`} /></div>
  <p className="t-label ds-tpl-plan-sub">03 · Decisions</p>
  <div className="ds-tpl-decisions"><div className="ds-tpl-decision"><h4 className="t-title">Show the bill before it is a bill.</h4><p>S1 is the running total, updated as events land, so the invoice on S2 is never a surprise.</p></div><div className="ds-tpl-decision"><h4 className="t-title">One primary action per screen.</h4><p>Preview invoice on S1, Issue on S2. Everything else is a link or a ⌘K command.</p></div><div className="ds-tpl-decision"><h4 className="t-title">Unmatched meters block issue, not ingest.</h4><p>Events are always accepted; S2e lists the meters with no price and keeps the mapping the user has done.</p></div></div>
  <p className="t-label ds-tpl-plan-sub">04 · Execution ledger</p>
  <table className="ds-tpl-ledger"><thead><tr><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody><tr><td><s>Wireframes S1, S2, S2e reviewed</s></td><td>Design</td><td><span className="ds-tpl-tag is-ok">Done</span></td></tr><tr><td><s>Meter ingestion idempotent on event id</s></td><td>Platform</td><td><span className="ds-tpl-tag is-ok">Done</span></td></tr><tr><td>S1 running-bill query under 200ms at 1M events</td><td>Platform</td><td><span className="ds-tpl-tag is-warn">In progress</span></td></tr><tr><td>S2e mapping screen</td><td>App</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr><tr><td>Mobile bottom action on S1</td><td>App</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr><tr><td>Verify a full month on the fixture workspace</td><td>QA</td><td><span className="ds-tpl-tag is-idle">Pending</span></td></tr></tbody></table>
  <p className="ds-tpl-wire-cap">Done means: a fixture workspace with one million events shows the right running bill on S1 within 200ms and issues the matching invoice from S2, and an unmatched meter routes through S2e without losing the mapping.</p>
</div>
```

### App · best

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.

```jsx
<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Meridian</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="Search invoices" value="$pick" /><button className="me-btn me-btn-primary">Create invoice</button></div></div>
  <div className="ds-tpl-rows"><div className="ds-tpl-row"><span className="ds-tpl-row-name">Acme Ltd · #1042</span><span className="ds-tpl-row-meta">$4,800 · due 4 Oct</span><span className="ds-tpl-tag is-ok">Paid</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Northwind · #1041</span><span className="ds-tpl-row-meta">$2,150 · due 2 Oct</span><span className="ds-tpl-tag is-warn">Pending</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Globex · #1038</span><span className="ds-tpl-row-meta">$960 · 6 days late</span><span className="ds-tpl-tag is-bad">Past due</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Initech · #1037</span><span className="ds-tpl-row-meta">$1,200 · draft</span><span className="ds-tpl-tag is-idle">Draft</span></div></div>
  <div className="ds-tpl-form"><Select label="Period" value="$pick" options={["30 days", "90 days", "12 months"]} /><Switch label="Include drafts" checked="$flag" /><button className="me-btn">Save</button></div>
</div>
```

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">Billing for software teams</p><h3 className="t-display-xl ds-tpl-hero-h">Invoices that pay themselves.</h3><p className="ds-tpl-hero-sub">Usage-based billing, dunning and payouts in one quiet dashboard. Set up in an afternoon; never think about it again.</p><div className="ds-row"><button className="me-btn me-btn-primary">Start for free</button><button className="me-btn">Read the docs</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Usage in, invoices out</h4><p>Meter any event and bill it monthly, with proration handled for you.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Dunning that works</h4><p>Retry schedules, card-update emails and a hosted portal, on by default.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Three-day payouts</h4><p>Settled funds reach your account on the third business day, every time.</p></div></div>
</div>
```

## Do and don't

- Put every surface on the canvas with a hairline and the 1px top highlight; reserve the shadow for things that float.
- One blue fill per view.
- Sentence case everywhere, including buttons and table heads.
- Keep body at 14px and let spacing make the hierarchy.
- Show shortcuts as keycaps beside the action they trigger.

Don't:

- No bold display type; semibold with tight tracking is the ceiling.
- No caps labels, no letter-spaced eyebrows; the mono eyebrow with a dot is the only ornament.
- No gradients beyond the glow and the glass edge, no coloured chrome.
- No rounded corners above 12px; Meridian is not friendly, it is calm.
- No drop shadows on tiles.

## What has no slot

The top highlight, the glass edge, the glow, the keycap inset and the hairline-strong hover state have no contract slot; they are the --ds-* properties and me-* classes above. Kit components already match the shape of Meridian, so the losses are small.
