---
name: system-nocturne
kind: data
description: >-
  Nocturne, a design system for artifactbin: Read it slowly, by one lamp. Atmospheric; for long reads, features, evening and culture subjects. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Nocturne.** One lamp, a dark room, and a long read. Nocturne is the page you read at night: a midnight ground, cream type with long leading, and one pool of amber light where the attention goes. Headlines are a light serif with an italic phrase that glows; kickers are carved small caps; figures sit in a mono HUD. It is a mood, not a place: the subject brings the scene, Nocturne brings the lamp.

- **Use it for:** Long features and essays, culture and evening subjects, reports that want to be read slowly, pilots and their results, any scrolly where things light up as the reader goes.
- **Avoid it when:** Operational tools, dense tables, anything read in a hurry or in daylight on a phone, and subjects that need a cheerful or clinical register.
- **Fit:** Dashboard avoid · Deck good · Editorial best · Scrolly best · Plan avoid · App avoid · Landing good.
- **Fonts:** Newsreader · Cinzel · JetBrains Mono, every weight the roles use, served by the runtime. Opens night first.
- **Published specimen:** `/a/CSOdyM` on the public artifactbin renders everything below in both modes. From: editorial_opus-a + b, generalised: lamplit dark editorial.

## Bind it

1. Fence: `theme: nocturne`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Nocturne (CSOdyM) · base=<theme> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-lamp: #0a7f5a; } .dark { --ds-lamp: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(48px, 7.5vw, 104px)/.92 · 300 | One per page. Newsreader light at display size; the emphasised phrase goes italic in lamp-hot. |
| `t-display-l` | display · clamp(32px, 4.5vw, 56px)/1 · 300 | Section openers and chapter heads. |
| `t-display-italic` | display · clamp(32px, 4.5vw, 56px)/1 · 400 | The emphasised phrase inside a headline, in lamp-hot with the text glow. |
| `t-caps` | caps · 12px/18px · 500 | Kickers, chapter marks, folios. Cinzel, widely tracked, with a 34px rule before it. |
| `t-title` | display · 24px/30px · 500 | Panel and figure titles. |
| `t-body-l` | sans · 21px/34px · 300 | Standfirsts and lead paragraphs. Light weight, long leading. |
| `t-body` | sans · 18px/30px · 400 | Reading text, oldstyle numerals. Long reading is the point. |
| `t-note` | sans · 15px/22px · 400 | Marginalia, figure notes, asides. |
| `t-label` | mono · 11px/16px · 500 | HUD counters, captions, table heads. Mono caps, small. |
| `t-numeral` | mono · 40px/44px · 500 | Figures. Tabular; lamp when it is the one that glows. |

## Colour

Night is a deep blue-black with a raised stone-blue for panels. Text is warm cream so the page feels printed, not screened; secondary text is a cool blue. Lamp amber is the only brand colour; ember is the lamp itself and the focus ring; cool is the second series and the second drawing fill. By day the ground is lamplit cream, the ink dark, and the ambers deepened.

| Token | Use |
|---|---|
| `--ds-night` | Page ground: midnight by night; by day, lamplit cream. |
| `--ds-night-raised` | Panels, cards and the lit stone of a panel. |
| `--ds-night-sunk` | Wells, code, the unlit cells. |
| `--ds-line` | Hairline rules and quiet borders. |
| `--ds-ink` | Primary text: cream on night, ink on cream. |
| `--ds-ink-soft` | Standfirsts and secondary reading text. Cool blue by night. |
| `--ds-ink-muted` | Captions, folios, placeholders. |
| `--ds-lamp` | The brand: lamplight amber. Links, the lit cell, the one figure that glows, the primary action. |
| `--ds-on-lamp` | Text on lamp fills. |
| `--ds-lamp-hot` | The hot centre of the lamp: the italic phrase in a headline, the filament. |
| `--ds-lamp-soft` | Ground for highlighted rows and the halo behind a lit thing. |
| `--ds-ember` | The accent: the lamp itself, the focus ring, the comparison series. |
| `--ds-on-ember` | Text on ember fills. |
| `--ds-cool` | The cool counterweight: the second drawing fill, the second chart series, the sky wash. |
| `--ds-positive` | Open, continued, confirmed. Always with a word. |
| `--ds-positive-soft` | Ground for positive rows. |
| `--ds-caution` | Small sample, provisional, late. The lamp, slightly cooler. |
| `--ds-caution-soft` | Ground for caveats. |
| `--ds-negative` | Closed, declined, failed. Rust. |
| `--ds-negative-soft` | Ground for negative rows. |

Chart series order: lamp, cool, ember, positive, ink-muted. Amber leads, cool blue is the comparison, ember the third. On night, axes and gridlines are the line token; by day they are ink-muted.

## Components

Kit components take Nocturne through the contract: night grounds, cream text, amber primary, 2px radius. Authored classes add the halo, the caps kicker with its rule, the HUD counters and the marginal note.

- **Buttons.** Kit buttons left; authored n-btn right: Cinzel caps, a 1px edge in the current ink, the primary in lamp with a halo on hover.
- **Tags.** Tags are mono caps in a pill. Lit and unlit are a filled or hollow dot; status tags carry a word with the colour.
- **Fields.** Fields are raised night panels with a hairline; focus is an ember outline. Labels are mono caps.
- **Stat.** A Stat is a HUD counter: mono caps label, a numeral, a caption naming the denominator. The lit Stat carries the halo and an amber figure.
- **Callouts.** Callouts are notes in the body voice with a 2px left rule. Caveats take caution; a decision takes lamp. The marginal note is the fourth: numbered, italic, hung in the margin.
- **Chart.** A chart is drawn in two warm tones on night: amber for the measure, cool for the comparison, with hairline axes.
- **Table.** The ledger: hairline rows, mono figures, the lit row tinted lamp-soft.
- **Card.** A card sits in its own lamp pool: caps kicker with the rule, a serif title, body copy, a row of cells lit in proportion, and a HUD line. Hover brightens the halo.

```jsx
<Button>Read on</Button><Button variant="secondary">Save</Button><Button variant="outline">Method</Button><Button variant="ghost">Skip</Button><button className="n-btn n-btn-primary">Read on</button><button className="n-btn">The method</button>
<Badge>Lit</Badge><Badge variant="secondary">Thursday</Badge><Badge variant="outline">Illustrative</Badge><Badge variant="destructive">Closed</Badge><span className="n-tag n-tag-lit">● Lit</span><span className="n-tag">○ Unlit</span><span className="n-tag n-tag-caution">Small sample</span><span className="n-tag n-tag-positive">Continues</span>
<div className="n-stat n-stat-lit"><span className="t-label">Loaves, six nights</span><span className="t-numeral"><Number data="$totals" col="loaves" format=",.0f" /></span><span className="n-note">the lit figure</span></div><div className="n-stat"><span className="t-label">Baked before six</span><span className="t-numeral"><Number data="$totals" col="before_six_pct" suffix="%" /></span><span className="n-note">of all loaves</span></div>
<Alert><AlertTitle>Loaves are not orders</AlertTitle><AlertDescription>One order can be twelve loaves; the night count is loaves out of the oven.</AlertDescription></Alert><div className="n-callout n-callout-caution"><strong>Small sample.</strong> Six nights in one week. Read the shares as a hint, not a measure.</div><div className="n-callout n-callout-lit"><strong>Decision.</strong> The four o&#39;clock start continues through winter.</div><aside className="n-margin"><span className="n-margin-n">1</span>A marginal note: set small, italic, hung to the side of the paragraph it explains.</aside>
<div className="n-card n-pool"><p className="t-caps n-caps"><i className="n-kicker-rule"></i>Chapter two</p><h3 className="t-title">The quiet shift</h3><p className="n-card-p">After eight the room changes hands: laptops close, a chess board opens, and the people who stay are the ones with nowhere warmer to be.</p><div className="n-cells"><i className="n-cell-lit"></i><i className="n-cell-lit"></i><i className="n-cell-lit"></i><i className="n-cell-lit"></i><i className="n-cell-lit"></i><i className=""></i><i className=""></i><i className=""></i></div><p className="t-label n-hud">Lit 5 / 8 · 8:10 PM</p></div>
```

Classes the runtime provides: `h-glow`, `h-ink`, `h-text`, `h-num`, `n-night`, `n-star`, `n-pool-in`, `n-pool-out`, `n-lit`, `n-dark`, `n-ribbon`, `n-tally`, `n-caps`, `n-kicker-rule`, `n-em`, `n-btn`, `n-btn-primary`, `n-tag`, `n-tag-lit`, `n-tag-caution`, `n-tag-positive`, `n-stat`, `n-stat-lit`, `t-numeral`, `n-note`, `n-callout`, `n-callout-caution`, `n-callout-lit`, `n-margin`, `n-margin-n`, `n-pool`, `n-card`, `n-card-p`, `n-cells`, `n-cell-lit`, `n-cells-lg`, `n-hud`, `n-folio`, `n-stat-row`, `n-sample`, `n-sample-grid`, `n-sample-bottom`.

## The hand

Thin cream lines, and the lamp behind them. Nocturne draws like a line engraving seen by lamplight: 1.5px cream strokes with round caps, flat amber for what is lit and cool blue for what is not, and behind every ink line a soft amber glow copy so the drawing seems to sit in the pool. By day the glow drops to a faint halo. Draw whatever the subject is; keep the lamp.

| Rule | How |
|---|---|
| Stroke | 1.5px in the ink colour (cream by night), round caps and joins. |
| Fill | Flat amber for the lit part; cool blue for the quiet part; night-sunk for unlit cells. |
| Glow | A 9px copy of every stroke in amber at 32% opacity, under the ink. 18% by day. |
| Ground | A panel sits in a lamp pool: radial from night-raised to night. |
| Figures | Mono caps at 11px in the HUD corner; the display face, light, for the one number. |
| Motion | Cells light with 60ms stagger; the pool does not move. |

Drawing mode `glow`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Three devices carry most pages: a lamp pool to hold the lit thing, a ribbon that keeps the reader's place, and a tally for small counts. A field of cells lights in proportion for the big count.

- **The lamp pool.** A radial wash from raised night to night, centred a little above the figure it holds. One per view. Put the lit figure in amber at its centre and the HUD line at its edge.
- **The ribbon and the tally.** A bookmark ribbon down the margin grows with reading progress; a tally of strokes counts small things (nights, sessions, people) with the fifth stroke crossing.
- **The lit field.** A grid of cells, one per unit, lit amber in proportion as the reader scrolls. Use it for the big count; the HUD under it reads lit over total.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Operational tools, dense tables, anything read in a hurry or in daylight on a phone, and subjects that need a cheerful or clinical register.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · best

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.

```jsx
<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">Night shift · Feature</p>
  <h3 className="t-display-l ds-tpl-ed-h">What the city eats before it wakes</h3>
  <p className="ds-tpl-deck">Six nights on a corner stool in a bakery that starts at four. The flour, the orders, the quiet hour, and the numbers that can only say so much.</p>
  <p className="t-label ds-tpl-byline">From the corner stool · 2 Oct 2026 · 14 min read</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">A</span>t four the lights come on in a room that smells of yesterday. Two people, one oven, and a list pinned to the wall: twelve cafés, three shops, the Saturday market. By six the list is mostly crossed off and the first bus has gone past twice. Nothing about the hour is romantic to the people in it; it is simply when bread has to happen.</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n"><Number data="$totals" col="loaves" format=",.0f" /></span><span className="t-label">Loaves, six nights</span></div>
  </div>
</div>
```

### Scrolly · best

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand.

```jsx
<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps"><div className="ds-tpl-step"><span className="t-label">01</span><h4 className="t-title">Four o'clock.</h4><p>The ovens reach temperature. Eighteen trays are laid out; each cell in the figure is one tray, dark until it goes in.</p></div><div className="ds-tpl-step"><span className="t-label">02</span><h4 className="t-title">Six o'clock.</h4><p>Thirteen trays are out and the cells are lit. The five still dark are the day shift's: brioche, the market order, the loaves that need the slow proof.</p></div></div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">{/* draw this screen in the hand */}</div><p className="t-label ds-tpl-figure-cap">Fig. 1 · Eighteen trays, lit as they leave the oven · synthetic</p></div>
</div>
```

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Operational tools, dense tables, anything read in a hurry or in daylight on a phone, and subjects that need a cheerful or clinical register.

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Operational tools, dense tables, anything read in a hurry or in daylight on a phone, and subjects that need a cheerful or clinical register.

### Landing · good

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Classes the specimen uses: `ds-tpl-landing`, `ds-tpl-hero`, `ds-tpl-hero-words`, `t-label`, `ds-tpl-kicker`, `t-display-xl`, `ds-tpl-hero-h`, `ds-tpl-hero-sub`, `ds-row`, `n-btn`, `n-btn-primary`, `ds-tpl-hero-art`, `h-ground`, `h-muted`, `h-fill`, `h-fill2`, `h-glow`, `h-ink`, `h-num`, `h-text`, `ds-tpl-feats`, `ds-tpl-feat`, `t-title`.

## Do and don't

- One lamp pool per view; put the lit figure at its centre.
- Say the denominator next to every percentage.
- Amber only for what is lit, open or chosen.
- Give long reading a long measure and a long leading.

Don't:

- No photographs as the hero; no stock illustration.
- No twinkling, parallax or ambient motion beyond one blinking cue.
- No second warm colour beyond ember.
- No status colour inside a drawing.

## What has no slot

The lamp pool gradient, the text glow, the halo, the Cinzel caps role and the ribbon have no contract slot; they are the --ds-halo and --ds-glow-text properties and the n-* classes. Kit components follow the night grounds and amber primary but not the caps apparatus.
