---
name: system-volta
kind: data
description: >-
  Volta, a design system for artifactbin: Loud where it counts. Quiet everywhere else. Loud; for data products, dashboards, launch pages. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Volta.** A risograph print of a dashboard. Paper-and-ink calm everywhere, then one hit of electric vermilion exactly where the eye should land. Hard edges, hard shadows, no blur, no gradients. Volta is for data products that refuse to be beige: the restraint is what makes the one loud thing land.

- **Use it for:** Analytics products, operational dashboards, pricing and launch pages, anything where one number or one action must dominate a busy screen.
- **Avoid it when:** Long reading (the hard edges tire over 800 words), luxury or institutional subjects, and anything that needs more than one loud element per view.
- **Fit:** Dashboard best · Deck best · Editorial avoid · Scrolly best · Plan good · App best · Landing best.
- **Fonts:** Bricolage Grotesque · Instrument Sans · JetBrains Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: volta`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container text-foreground">`, then kit components, token classes and the classes below. Keep layout wrappers transparent: the runtime paints the system's page ground, including textures. Use an opaque surface only for a deliberate panel or section; a blanket `bg-background` hides that ground.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Volta · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-volt: #0a7f5a; } .dark { --ds-volt: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(56px, 9vw, 112px)/.9 · 800 | One per page, at most. Hero headlines and covers. |
| `t-display-l` | display · clamp(36px, 5vw, 60px)/.95 · 800 | Section openers, empty-state headlines. |
| `t-display-m` | display · 40px/40px · 700 | Page titles. |
| `t-title` | display · 22px/28px · 700 | Card and dialog titles. |
| `t-body-l` | sans · 18px/28px · 400 | Lead paragraphs. |
| `t-body` | sans · 15px/22px · 400 | Default UI and reading text. |
| `t-body-s` | sans · 13px/18px · 400 | Captions, helper text, dense table cells. |
| `t-label` | sans · 12px/16px · 600 | Eyebrows, tab labels, tag text. Caps come from CSS, never the copy. |
| `t-numeral` | mono · 40px/44px · 600 | Numeric KPI figures. Tabular by nature: digits never jump. For prose KPI values, use a text role such as t-title or t-body, rather than the large mono numeral. |
| `t-mono` | mono · 13px/20px · 400 | Code, SQL, IDs, table numbers. |

## Colour

Two themes: Paper (light, first and fallback) and Night. In Night the hard shadow turns volt, so interactive things glow. Volt is a fill only (2.9:1 on paper); volt as text is volt-ink. Status never relies on colour alone: always a word, a ▲/▼ or a glyph.

| Token | Use |
|---|---|
| `--ds-paper` | Page ground. The default surface for everything. |
| `--ds-paper-raised` | Cards, fields, menus: anything that sits on paper. |
| `--ds-paper-sunk` | Wells, code blocks, inactive tracks, table stripes. |
| `--ds-line` | Hairline dividers and quiet borders. Never the sole edge of a control. |
| `--ds-edge` | The hard 2px edge on controls and cards, and the hard offset shadow. |
| `--ds-ink` | Primary text and icons on every paper ground. |
| `--ds-ink-muted` | Secondary text, captions, placeholders. |
| `--ds-volt` | The brand. Primary actions and the one number that must be seen. Fill only. |
| `--ds-on-volt` | Text and icons on volt fills. |
| `--ds-volt-ink` | Volt as text: links and inline emphasis on paper. |
| `--ds-volt-soft` | Tinted ground for volt tags and selected rows; text on it is volt-ink. |
| `--ds-acid` | The highlighter: new tags, the active tab marker, one insight card. Never body text. |
| `--ds-on-acid` | Text on acid fills. |
| `--ds-cobalt` | Data and focus: the first chart series, the focus ring, info callouts. |
| `--ds-on-cobalt` | Text on cobalt fills. |
| `--ds-cobalt-soft` | Ground for info callouts; text on it is ink. |
| `--ds-positive` | Positive deltas and success text, always with a ▲ or a word. |
| `--ds-positive-soft` | Ground for success callouts and positive tags. |
| `--ds-caution` | Warnings, always with a word. |
| `--ds-caution-soft` | Ground for warning callouts. |
| `--ds-negative` | Negative deltas and errors. Shares volt-ink: errors are loud, not a separate red. |
| `--ds-negative-soft` | Ground for error callouts. |

Chart series order: cobalt, volt, ink-muted, positive, caution. The focal series is always cobalt; volt is the comparison; the neutral third series is ink-muted. Series are ordered by lightness so they stay distinct without hue.

## Components

Kit components take Volta through the contract: paper grounds, volt primary, cobalt ring, 4px radius. The signature hard edge and offset shadow are classes you put on authored elements: v-hard on a card, v-btn on a button.

- **Buttons.** Kit buttons on the left; authored v-btn on the right with the 2px edge and hard shadow. One primary per view. Acid is reserved for AI-assisted actions, never destructive ones.
- **Tags.** Tags are the label role in caps. Status tags carry a glyph or a word with the colour, never colour alone.
- **Fields.** Fields sit on paper-raised with the 2px edge; the focus ring is cobalt with a paper gap. Labels are the label role above the field.
- **Stat.** Stat is a label, a numeric figure and a delta with a ▲/▼ glyph. Use t-numeral for figures and a text role for prose values. Stack a crowded stats row at phone width and check every value fits at 390px. One accented Stat per row, for the number that matters most. Figures come from data, never typed.
- **Callouts.** A callout states the fact, then the fix. Status grounds are the soft tokens; the text stays ink.
- **Chart.** Charts take the chart tokens in order: cobalt first, volt for the comparison. No gradient fills; direct labels where they fit.
- **Table.** Tables are ink on paper with hairline rows and mono figures; the hard edge belongs to the container, not to each cell.
- **Card.** An interactive card casts shadow-hard-lg and lifts on hover; a static card is flat with a hairline. Card titles are the title role.

```jsx
<Button>Run query</Button><Button variant="secondary">Save view</Button><Button variant="outline">Export</Button><Button variant="ghost">Cancel</Button><button className="v-btn v-btn-primary">Run query</button><button className="v-btn v-btn-acid">Ask Volta</button><button className="v-btn">Export</button>
<Badge>Volt</Badge><Badge variant="secondary">Selected</Badge><Badge variant="outline">Draft</Badge><Badge variant="destructive">Failed</Badge><span className="v-tag v-tag-acid">New</span><span className="v-tag v-tag-positive">▲ 12%</span><span className="v-tag v-tag-caution">Stale</span><span className="v-tag v-tag-cobalt">Info</span>
<div className="v-stat"><span className="t-label">Revenue</span><span className="t-numeral"><Number data="$totals" col="revenue" prefix="$" format=",.0f" /></span><span className="v-delta v-up">▲ 12% vs last week</span></div><div className="v-stat v-stat-accent"><span className="t-label">Annual plans</span><span className="t-numeral"><Number data="$totals" col="annual_share" suffix="%" /></span><span className="v-delta">of growth</span></div>
<Alert><AlertTitle>No table called orderz</AlertTitle><AlertDescription>Did you mean orders?</AlertDescription></Alert><div className="v-callout v-callout-info"><strong>Cobalt means information.</strong> A hint about the data, not an alarm.</div><div className="v-callout v-callout-positive"><strong>Saved.</strong> Your view is shared with the team.</div><div className="v-callout v-callout-negative"><strong>Query timed out after 5s.</strong> Add a date filter and run it again.</div>
<div className="v-hard v-card"><p className="t-label">Insight</p><h3 className="t-title">Annual plans drove 70% of growth</h3><p className="v-card-body">Monthly plans added 1,120 customers but 410 churned inside 90 days. Annual plans added 640 and kept 612. Reorder the pricing page.</p><button className="v-btn v-btn-primary">Open cohort</button></div>
```

Classes the runtime provides: `v-edge`, `v-volt`, `v-acid`, `v-cobalt`, `v-positive`, `v-rim`, `v-stripe`, `v-muted`, `v-volt-ink`, `v-btn`, `v-btn-primary`, `v-btn-acid`, `v-tag`, `v-tag-acid`, `v-tag-positive`, `v-tag-caution`, `v-tag-cobalt`, `v-stat`, `v-stat-accent`, `t-label`, `v-delta`, `v-up`, `v-down`, `v-callout`, `v-callout-info`, `v-callout-positive`, `v-callout-negative`, `v-hard`, `v-card`, `v-card-body`, `v-panel`, `h-num`.

## The hand

Flat blocks, a 2px edge, one slipped shadow. Volta draws like a two-colour riso print: flat fills in volt and cobalt, a square-capped 2px edge in ink, and a hard shadow offset by 6px as if the second plate slipped. No gradients, no rounded strokes, no texture except the stripe screen. The subject is whatever the artifact is about; the hand is this.

| Rule | How |
|---|---|
| Stroke | 2px ink, square caps, square joins. Every shape has it. |
| Fill | Flat volt or cobalt; sunk paper for the quiet parts. |
| Shadow | 6px hard offset in ink (volt in Night). Only on the main body of the drawing. |
| Texture | The 4px stripe screen, clipped inside a block, for pending or unknown regions. |
| Figures | Mono caps at 11px for labels; the display face for the one number. |
| Motion | A drawing may lift 2px on hover; it never fades in. |

Drawing mode `flat`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-shadow`, `--ds-hand-stroke`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Volta draws with flat blocks and a 4px stripe screen, like a two-colour riso print whose plates slipped by one shadow. Use one device per page, and let the data live inside it.

- **The stripe screen.** A 4px edge stripe at a 16px pitch, clipped inside a block. Use it as the texture of a selected or pending region, or as a bar fill for the "unknown" share.
- **The split bar.** One number split into its parts as a single bar with hard edges: 240 + 160, annual against monthly. Label every segment inside it; no legend.
- **The status dot.** The one round thing. A volt dot pulses for live, a positive dot for healthy, an ink dot for idle; each sits next to a word.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · best

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours.

```jsx
<div className="ds-tpl ds-tpl-dash">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Volta</span><span className="t-label ds-tpl-crumb">Weekly review · Revenue</span><div className="ds-tpl-bar-end"><Segmented label="Window" value="$pick" options={["Week", "Month", "Quarter"]} /></div></div>
  <div className="ds-tpl-kpis"><div className="ds-tpl-kpi"><span className="t-label">Revenue, 90 days</span><span className="t-numeral"><Number data="$totals" col="revenue" prefix="$" format=",.0f" /></span><span className="ds-tpl-delta">▲ 12% vs prior</span></div><div className="ds-tpl-kpi"><span className="t-label">New customers</span><span className="t-numeral"><Number data="$totals" col="customers" format=",.0f" /></span><span className="ds-tpl-delta">1,120 monthly · 640 annual</span></div><div className="ds-tpl-kpi"><span className="t-label">Kept at 90 days</span><span className="t-numeral"><Number data="$totals" col="kept_pct" suffix="%" /></span><span className="ds-tpl-delta">▼ 4 pts vs prior</span></div></div>
  <div className="ds-tpl-dash-grid">
    <div className="ds-tpl-tile"><span className="t-label">Revenue by plan, weekly</span><Question data="$series" height="240px" viz={{"kind": "vega-lite", "spec": {"mark": {"type": "bar"}, "encoding": {"x": {"field": "week", "type": "ordinal", "title": "Week"}, "y": {"field": "revenue", "type": "quantitative", "title": "Revenue ($)"}, "color": {"field": "plan", "type": "nominal", "title": "Plan"}, "xOffset": {"field": "plan"}}}}} /></div>
    <div className="ds-tpl-tile"><span className="t-label">Cohorts</span><DataTable data="$table" rowKey="plan" height="240px" columns={[{"col": "plan", "title": "Plan"}, {"col": "customers", "title": "New", "align": "right"}, {"col": "kept", "title": "Kept", "align": "right"}, {"col": "kept_pct", "title": "Kept %", "fmt": ".0f", "align": "right", "bar": true}]} /></div>
  </div>
</div>
```

### Deck · best

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule.

```jsx
<div className="ds-tpl ds-tpl-slides">
  <div className="ds-tpl-stage ds-tpl-stage-title">
    <div className="ds-tpl-stage-top"><span>Volta</span><span>Pricing review</span></div>
    <h3 className="ds-tpl-slide-h">Annual plans drove 70% of growth.</h3>
    <p className="ds-tpl-slide-sub">Monthly plans add more customers and lose most of them inside a quarter.</p>
    <div className="ds-tpl-stage-foot"><span>01 / 06</span><span>Synthetic data · Oct 2026</span></div>
  </div>
  <div className="ds-tpl-stage ds-tpl-stage-stat">
    <div className="ds-tpl-stage-top"><span>Volta</span><span>02 · Kept at 90 days</span></div>
    <div className="ds-tpl-slide-big"><Number data="$totals" col="kept_pct" suffix="%" /></div>
    <p className="ds-tpl-slide-cap">Of every 100 new customers, this many are still paying at day 90. Annual cohorts keep 96 of 100.</p>
    <div className="ds-tpl-split"><span className="ds-tpl-split-a">ANNUAL · 70%</span><span className="ds-tpl-split-b">MONTHLY · 30%</span></div>
    <div className="ds-tpl-stage-foot"><span>02 / 06</span><span>Synthetic data · Oct 2026</span></div>
  </div>
</div>
```

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Long reading (the hard edges tire over 800 words), luxury or institutional subjects, and anything that needs more than one loud element per view.

### Scrolly · best

Template: scrolly. Chapters and their figures stay in ordinary document flow; the author supplies each chapter’s figure state and the system owns the step card and figure, drawn in its hand.

```jsx
<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps"><div className="ds-tpl-step"><span className="t-label">01</span><h4 className="t-title">One hundred customers walk in.</h4><p>Sixty pick monthly, forty pick annual. Each square is one customer; the colour is the plan.</p></div><div className="ds-tpl-step"><span className="t-label">02</span><h4 className="t-title">Ninety days later.</h4><p>The monthly squares thin out: 37 of the 60 remain. The annual block is nearly whole.</p></div></div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">{/* draw this screen in the hand */}</div><p className="t-label ds-tpl-figure-cap">Fig. 1 · One batch of 100, by outcome · synthetic</p></div>
</div>
```

### Plan · good

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Classes the specimen uses: `ds-tpl-plan`, `ds-tpl-plan-head`, `t-label`, `ds-tpl-kicker`, `t-display-m`, `ds-tpl-plan-h`, `ds-tpl-plan-brief`, `ds-tpl-plan-sub`, `ds-tpl-wires`, `ds-tpl-wire`, `ds-tpl-wire-desk`, `h-shadow`, `h-ground`, `h-muted`, `h-fill`, `h-fill2`, `h-ink`, `h-text`, `ds-tpl-wire-cap`, `ds-tpl-flow`, `ds-tpl-decisions`, `ds-tpl-decision`, `t-title`, `ds-tpl-ledger`, `ds-tpl-tag`, `is-ok`, `is-warn`, `is-idle`.

### App · best

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.

```jsx
<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Volta</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="Search tables" value="$pick" /><button className="v-btn v-btn-primary">New job</button></div></div>
  <div className="ds-tpl-rows"><div className="ds-tpl-row"><span className="ds-tpl-row-name">Nightly backfill</span><span className="ds-tpl-row-meta">Runs 02:00 · 4m 12s</span><span className="ds-tpl-tag is-ok">Healthy</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Stripe sync</span><span className="ds-tpl-row-meta">Last run 11 min ago</span><span className="ds-tpl-tag is-warn">Stale</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Cohort export</span><span className="ds-tpl-row-meta">Failed on step 3</span><span className="ds-tpl-tag is-bad">Failed</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Weekly digest</span><span className="ds-tpl-row-meta">Scheduled · Mon 09:00</span><span className="ds-tpl-tag is-idle">Idle</span></div></div>
  <div className="ds-tpl-form"><Select label="Window" value="$pick" options={["Week", "Month", "Quarter"]} /><Switch label="Compare to prior" checked="$flag" /><button className="v-btn">Save</button></div>
</div>
```

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">Volta analytics</p><h3 className="t-display-xl ds-tpl-hero-h">Ask a question. Get the number.</h3><p className="ds-tpl-hero-sub">Plain-words questions over your warehouse, answered with a chart and the SQL that made it. No dashboards to build first.</p><div className="ds-row"><button className="v-btn v-btn-primary">Start free</button><button className="v-btn">See a demo</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Numbers first</h4><p>The figure leads; the chart explains it; the SQL is one click away.</p></div><div className="ds-tpl-feat"><h4 className="t-title">One loud thing</h4><p>Every answer marks the number that matters and nothing else.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Your warehouse</h4><p>Postgres, BigQuery, Snowflake. Read-only, in your region.</p></div></div>
</div>
```

## Do and don't

- One volt element per view.
- Figures in the numeral role, tabular.
- Hard 2px edges and offset shadows on anything you can click.
- Let the finding be the headline; put the number next to it in volt.

Don't:

- No blur, no gradients, no soft shadows.
- No volt as text on paper; use volt-ink.
- No two primaries side by side.
- No rounded cards; radius is 0 for containers.

## What has no slot

The hard edge as distinct from the hairline, the acid highlighter, the soft status grounds and raised versus sunk paper have no contract slot. They are carried as --ds-* properties and the v-* classes above; kit components follow ink and paper but not the hard edge.
