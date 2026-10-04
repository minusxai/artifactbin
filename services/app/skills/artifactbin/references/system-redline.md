---
name: system-redline
kind: data
description: >-
  Redline, a design system for artifactbin: One word. Then the number. Poster; for slides, decision briefs, launch pages, posters. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Redline.** A poster that makes a decision. Redline sets a brief the way a good poster does: one condensed word that fills the surface, one number big enough to read from the back of the room, one red. Three surfaces (paper, red, ink) give a deck its rhythm, and small printed devices (a dotmatrix, a stamp, a split bar, a stripe) carry the figures. Everything is flat ink on stock. Nothing glows.

- **Use it for:** Slide decks and decision briefs, launch and campaign pages, one-page proposals, posters, anything whose first screen must be read in a second and remembered.
- **Avoid it when:** Long reading (condensed caps tire past a paragraph), dashboards with many simultaneous numbers, subjects that need warmth, softness or more than one colour.
- **Fit:** Dashboard avoid · Deck best · Editorial avoid · Scrolly good · Plan good · App avoid · Landing best.
- **Fonts:** Barlow Condensed · DM Sans · DM Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: redline`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Redline · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-red: #0a7f5a; } .dark { --ds-red: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(80px, 18vw, 240px)/.82 · 700 | The cover word. One per deck or page; it may run off the stage. |
| `t-display-l` | display · clamp(48px, 7.5vw, 104px)/.9 · 700 | Slide titles and section openers. |
| `t-display-m` | display · 44px/40px · 700 | Page titles, big labels beside a number. |
| `t-title` | display · 24px/26px · 700 | Card titles, list heads, feature titles. |
| `t-body-l` | sans · 19px/1.5 · 400 | Decks and the one sentence under a number. |
| `t-body` | sans · 16px/1.55 · 400 | Reading and interface text. |
| `t-body-s` | sans · 13px/18px · 400 | Captions, sources, the slide foot. |
| `t-label` | mono · 11px/16px · 400 | Eyebrows, toplines, list numbers, stamp text. Mono caps through CSS. |
| `t-numeral` | display · 64px/56px · 700 | KPI figures and the giant slide number. Condensed, tabular. |
| `t-mono` | mono · 13px/20px · 400 | Code, ratios, list figures. |

## Colour

Day first: paper ground, ink type, red for the surface that matters. Night is the ink slide as the page: ink ground, paper type, the red unchanged. Type on red is always ink, so red stays printed rather than lit. Status words use green and amber; the error colour is the red itself.

| Token | Use |
|---|---|
| `--ds-paper` | Page ground and the paper slide surface. |
| `--ds-paper-raised` | Cards, fields, the paper stage inside an ink page. |
| `--ds-paper-sunk` | Wells, tracks, table stripes, off dots. |
| `--ds-line` | Hairline rules: list rows, footers, the slide foot. |
| `--ds-ink` | Type, rules, the ink slide surface, the ink half of the split bar. |
| `--ds-ink-soft` | Secondary text, captions, muted eyebrows. |
| `--ds-on-ink` | Type on an ink surface. |
| `--ds-red` | The one colour. The red slide surface, the primary button, the accent half of a bar, the on dots. Unchanged in Night. |
| `--ds-on-red` | Type on red: ink, never paper, so red surfaces stay printed, not glowing. |
| `--ds-red-ink` | Red as text on paper: one word in a headline, a link, a delta. |
| `--ds-red-soft` | Ground for selected rows and red callouts; text on it is ink. |
| `--ds-positive` | Up, done, approved. Always with a word or a glyph. |
| `--ds-positive-soft` | Ground for success callouts. |
| `--ds-caution` | Pending, waiting, at capacity. |
| `--ds-caution-soft` | Ground for warning callouts. |
| `--ds-negative` | Down, failed, refused. The same red: errors are loud, there is one red. |
| `--ds-negative-soft` | Ground for error callouts. |

Chart series order: red, ink, ink-soft, positive, caution. Red is the series the slide is about; ink is the comparison; ink-soft the baseline. Prefer the split bar or the dotmatrix to a chart when the figure is one share or one sum.

## Components

Kit components take Redline through the contract: paper grounds, red primary, ink secondary, zero radius. The stage, the dotmatrix, the split bar, the stamp and the list row are authored rl-* classes written against the hand variables, so they port.

- **Buttons.** Kit buttons on the left; authored rl-btn on the right: condensed caps, 2px edge, square, inverted on hover. One red button per surface. On a red surface the primary is ink.
- **Tags.** Tags are mono caps in a 1px box. Status tags carry a glyph or a word with the colour; the red tag is a surface, not a status.
- **Fields.** Fields are paper-raised with a 1px line edge, square, with condensed caps labels above. Focus is a 3px red outline. The segmented control fills its active segment red with ink type.
- **Stat.** A stat is a mono label, a condensed numeral and one sentence, over a 2px rule. The red stat is the one the slide is about. Figures come from data.
- **Callouts.** A callout states the decision, then the condition. Status grounds are the soft tokens; the type stays ink.
- **Chart.** Charts take red first, ink second, square marks, no grid beyond the baseline. Use a chart only when a device cannot carry the figure.
- **Table.** Tables are list rows: a mono number, a condensed name, a sentence, each on a 1px top rule. No zebra, no cell borders.
- **Card.** A card is a paper stage in miniature: topline, condensed title, one device, one sentence, one action. Flat, square, hairline-edged.

```jsx
<Button>Approve the site</Button><Button variant="secondary">Request numbers</Button><Button variant="outline">Download brief</Button><Button variant="ghost">Later</Button><button className="rl-btn rl-btn-primary">Approve the site</button><button className="rl-btn rl-btn-ink">Request numbers</button><button className="rl-btn">Download brief</button>
<Badge>Red</Badge><Badge variant="secondary">Ink</Badge><Badge variant="outline">Draft</Badge><Badge variant="destructive">Refused</Badge><span className="rl-tag">Loop / 02</span><span className="rl-tag rl-tag-red">Proposal</span><span className="rl-tag is-ok">▲ Approved</span><span className="rl-tag is-warn">Waiting</span><span className="rl-tag is-bad">▼ Refused</span>
<div className="rl-stat"><span className="t-label">Repairs / month</span><span className="t-numeral"><Number data="$totals" col="orders" format=",.0f" /></span><span className="rl-stat-note">today, across one site</span></div><div className="rl-stat rl-stat-red"><span className="t-label">Added capacity</span><span className="t-numeral">+<Number data="$totals" col="added" /></span><span className="rl-stat-note">if the second site opens</span></div><div className="rl-stat"><span className="t-label">Days waiting</span><span className="t-numeral"><Number data="$totals" col="wait_days" format=".0f" /></span><span className="rl-stat-note">median, last quarter</span></div>
<Alert><AlertTitle>Proposal, not an approved investment</AlertTitle><AlertDescription>Every figure is illustrative until finance signs.</AlertDescription></Alert><div className="rl-callout rl-callout-red"><strong>Red means the moment.</strong> The one thing this slide asks you to decide.</div><div className="rl-callout rl-callout-ok"><strong>▲ Approved.</strong> The second site opens in Q2.</div><div className="rl-callout rl-callout-bad"><strong>▼ Refused.</strong> Demand is not established. Bring the waiting-list data.</div>
<div className="rl-card"><p className="t-label">Loop / 03 · The proposal</p><h3 className="t-display-m">More room. Same mission.</h3><div className="rl-bar"><span className="rl-bar-a">240</span><span className="rl-bar-b">+160</span></div><div className="rl-bar-labels"><span>Current repairs / month</span><span>Added capacity / month</span></div><p className="rl-card-body">The second site adds capacity equal to two-thirds of today&#39;s volume. 400 a month is an illustrative throughput, not a demand forecast.</p><button className="rl-btn rl-btn-primary">Approve the site</button></div>
```

Classes the runtime provides: `rl-paper`, `rl-red`, `rl-ink`, `rl-dot`, `rl-dot-on`, `rl-dot-red`, `rl-dot-paper`, `rl-stamp-rim`, `rl-on-red`, `rl-on-ink`, `rl-btn`, `rl-btn-primary`, `rl-btn-ink`, `rl-tag`, `rl-tag-red`, `is-ok`, `is-warn`, `is-bad`, `rl-stat`, `rl-stat-red`, `t-numeral`, `rl-stat-note`, `rl-callout`, `rl-callout-red`, `rl-callout-ok`, `rl-callout-bad`, `rl-card`, `rl-card-body`, `rl-bar`, `rl-bar-a`, `rl-bar-b`, `rl-bar-labels`, `rl-stamp`, `rl-list`, `rl-list-row`, `rl-deck`, `rl-stage`, `rl-stage-red`, `rl-stage-ink`, `rl-top`, `rl-foot`, `rl-brand`, `rl-cover-word`, `rl-cover-sub`, `rl-stat-row`, `rl-huge`, `rl-stat-h`, `rl-metric-bottom`, `rl-mark`, `rl-decision`, `rl-decision-copy`, `rl-sample`, `rl-stage-paper`.

## The hand

Flat ink on stock. Redline draws like a one-colour screen print: a 2px square-capped ink line, flat red for the part that matters, flat ink for the rest, sunk paper for the quiet parts. No shadow, no texture, no gradient; the figure sits in the display face. The subject is the artifact's; the hand is this.

| Rule | How |
|---|---|
| Stroke | 2px ink, square caps and joins. |
| Fill | Flat red for the one thing; flat ink for the comparison; sunk paper for the rest. |
| Shadow | None. Depth comes from the surface change, never from an offset. |
| Figures | DM Mono caps at 11px; Barlow Condensed for the one number. |
| Surface | A drawing may sit on paper, red or ink; on red its fills swap to ink. |
| Motion | A dotmatrix may fill dot by dot. Nothing else moves. |

Drawing mode `flat`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-hero-fg`, `--ds-hero-muted`, `--ds-slide-bg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Redline draws with flat ink on stock: 2px square-capped strokes, flat red or ink fills, no shadow. Its own devices below; each carries a figure, none is decoration.

- **The dotmatrix.** One hundred dots, ten by ten; the on dots are red and count the share. Label the ratio beside it in mono. For a share of a hundred, prefer this to a pie.
- **The split bar and the stripe.** One sum as one bar: ink for what exists, red for what is added, the figures inside each half. The stripe is a 110° hatch band that closes a section or underlines a total.
- **The stamp and the watermark.** A status lands as a mono stamp in a 2px box rotated -4°. Behind a decision slide, the decision word sits at 20% opacity, rotated -12°, as a watermark. One each per deck.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Long reading (condensed caps tire past a paragraph), dashboards with many simultaneous numbers, subjects that need warmth, softness or more than one colour.

### Deck · best

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule.

```jsx
<div className="ds-tpl ds-tpl-slides">
  <div className="ds-tpl-stage ds-tpl-stage-title">
    <div className="ds-tpl-stage-top"><span>loop</span><span>The second site</span></div>
    <h3 className="ds-tpl-slide-h">More room.</h3>
    <p className="ds-tpl-slide-sub">A second repair site: a proposal for more capacity, not a forecast of demand.</p>
    <div className="ds-tpl-stage-foot"><span>01 / 06</span><span>Synthetic brief · Oct 2026</span></div>
  </div>
  <div className="ds-tpl-stage ds-tpl-stage-stat">
    <div className="ds-tpl-stage-top"><span>loop</span><span>02 · The evidence</span></div>
    <div className="ds-tpl-slide-big"><Number data="$totals" col="orders" format=",.0f" /></div>
    <p className="ds-tpl-slide-cap">Repairs a month, at capacity for the second month. Customers return; service takes time.</p>
    <div className="ds-tpl-split"><span className="ds-tpl-split-a">240 TODAY</span><span className="ds-tpl-split-b">+160 ADDED</span></div>
    <div className="ds-tpl-stage-foot"><span>02 / 06</span><span>Synthetic brief · Oct 2026</span></div>
  </div>
</div>
```

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Long reading (condensed caps tire past a paragraph), dashboards with many simultaneous numbers, subjects that need warmth, softness or more than one colour.

### Scrolly · good

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Classes the specimen uses: `ds-tpl-scrolly`, `ds-tpl-steps`, `ds-tpl-step`, `t-label`, `t-title`, `ds-tpl-figure`, `ds-tpl-figure-art`, `h-fill`, `h-fill2`, `h-muted`, `h-ink`, `h-num`, `h-text`, `ds-tpl-figure-cap`.

### Plan · good

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Classes the specimen uses: `ds-tpl-plan`, `ds-tpl-plan-head`, `t-label`, `ds-tpl-kicker`, `t-display-m`, `ds-tpl-plan-h`, `ds-tpl-plan-brief`, `ds-tpl-plan-sub`, `ds-tpl-wires`, `ds-tpl-wire`, `ds-tpl-wire-desk`, `h-ground`, `h-muted`, `h-fill`, `h-fill2`, `h-ink`, `h-text`, `ds-tpl-wire-cap`, `ds-tpl-flow`, `ds-tpl-decisions`, `ds-tpl-decision`, `t-title`, `ds-tpl-ledger`, `ds-tpl-tag`, `is-ok`, `is-warn`, `is-idle`.

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Long reading (condensed caps tire past a paragraph), dashboards with many simultaneous numbers, subjects that need warmth, softness or more than one colour.

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">Loop repairs · Second site</p><h3 className="t-display-xl ds-tpl-hero-h">More room for the next ride.</h3><p className="ds-tpl-hero-sub">A second workshop in Q2, with a hundred and sixty more repairs a month. Same technicians, same mission, half the wait.</p><div className="ds-row"><button className="rl-btn rl-btn-primary">Book a repair</button><button className="rl-btn">Read the brief</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Half the wait</h4><p>Twelve days today. Six when the second room opens.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Same hands</h4><p>The crew moves between sites; the standard does not.</p></div><div className="ds-tpl-feat"><h4 className="t-title">One red</h4><p>Every price, every promise, printed in one colour so you can read it from the street.</p></div></div>
</div>
```

## Do and don't

- One word per cover, set to fill the surface.
- One number per slide, in the numeral role.
- Change surface (paper, red, ink) no more than every third slide.
- Carry figures in devices: dotmatrix, split bar, list rows.
- Set type on red in ink.

Don't:

- No second colour; status words use green and amber, nothing else does.
- No rounded corners, no shadows, no gradients.
- No full-colour photos: grayscale, multiplied onto red.
- No paragraphs in condensed caps.
- No two red elements on one surface.

## What has no slot

The three surfaces (red and ink as full slides), the split bar, the dotmatrix, the stamp, the watermark and the stripe have no contract slot. They are carried as --ds-* properties and the rl-* classes; kit components follow paper, ink and red but not the surface rhythm.
