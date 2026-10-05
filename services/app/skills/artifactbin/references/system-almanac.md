---
name: system-almanac
kind: data
description: >-
  Almanac, a design system for artifactbin: Warm paper, one green ink, one terracotta word. Warm; for scrolly explainers, landing pages, long reads, annual reports. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Almanac.** A field guide, set warm. Almanac is the studio that prints field guides: warm paper, one green ink for everything written, one terracotta word where the eye should land, and hairlines so light they feel drawn. Numbers go enormous in a serif and sit still. Panels have arched tops. Buttons are outlines until you touch them. It is calm without being beige, because the one accent is earned.

- **Use it for:** Scrolly explainers, landing pages for small makers and civic things, long reads, annual and impact reports, anything that wants to feel made by hand and read slowly.
- **Avoid it when:** Dense operational dashboards, dev tools, anything that must feel fast or cold, and pages that need more than one accent per view.
- **Fit:** Dashboard avoid · Deck good · Editorial best · Scrolly best · Plan avoid · App good · Landing best.
- **Fonts:** Instrument Serif · DM Sans · DM Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: almanac`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container text-foreground">`, then kit components, token classes and the classes below. Keep layout wrappers transparent: the runtime paints the system's page ground, including textures. Use an opaque surface only for a deliberate panel or section; a blanket `bg-background` hides that ground.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Almanac · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-accent: #0a7f5a; } .dark { --ds-accent: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(64px, 10.4vw, 160px)/.92 · 400 | One per page. Instrument Serif at 400 with the tracking pulled tight; the italic carries the emphasised word. |
| `t-display-l` | display · clamp(40px, 5.5vw, 78px)/.98 · 400 | Section openers and chapter heads. |
| `t-display-m` | display · 40px/42px · 400 | Card titles and page titles. |
| `t-title` | sans · 24px/1.2 · 500 | Sub-heads inside steps and features. |
| `t-numeral-xl` | display · clamp(72px, 9vw, 120px)/1 · 400 | The outcome numbers. Instrument Serif, tracked to -.07em, one per block. |
| `t-body-l` | sans · 18px/1.7 · 400 | Step paragraphs and lead copy at a generous 1.7 leading. |
| `t-body` | sans · 16px/1.6 · 400 | Default reading and UI text. |
| `t-body-s` | sans · 13px/1.5 · 400 | Captions, notes, footer lines. |
| `t-label` | mono · 11px/1.6 · 400 | Eyebrows, nav links, legends, chapter numbers. Caps from CSS. |
| `t-numeral` | display · 48px/1 · 400 | KPI figures in tiles and tickets. |
| `t-mono` | mono · 12px/1.6 · 400 | Code, IDs, table figures. |

## Colour

Paper first. Night turns the ink into the ground and lifts the terracotta so it still lands. There is no blue anywhere; the mauve exists only as a chart series. Status text shares the green and the terracotta; warnings are an ochre. Tags are tints of the same inks.

| Token | Use |
|---|---|
| `--ds-paper` | Page ground: warm, uncoated. In Night the ink becomes the ground. |
| `--ds-card` | Cards, tickets, dialogs: a lighter sheet on the paper. |
| `--ds-band` | The hero band and arch panels: a deeper warm ground that holds one big thing. |
| `--ds-screen` | The soft green ground inside a device or a figure. |
| `--ds-paper-sunk` | Wells, code, inactive tracks, stripes. |
| `--ds-line` | Hairlines at a quarter strength. The only border in the system. |
| `--ds-ink` | Forest green: all text, all rules, the first series. |
| `--ds-ink-muted` | Secondary text at 65%: captions, notes, metadata. |
| `--ds-accent` | Terracotta: the one word in a headline, the filled button, the progress bar, the second series. |
| `--ds-on-accent` | Text on terracotta. |
| `--ds-accent-soft` | Ground for accent tags and the selected state. |
| `--ds-mauve` | The third series and nothing else. |
| `--ds-positive` | Success text and the kept share, with a word. |
| `--ds-positive-soft` | Ground for success callouts and positive tags. |
| `--ds-caution` | Warnings as text: an ochre on paper. |
| `--ds-caution-soft` | Ground for warning callouts. |
| `--ds-negative` | Errors share the terracotta; there is no second red. |
| `--ds-negative-soft` | Ground for error callouts. |

Chart series order: ink, accent, mauve, positive, caution. Green, terracotta, mauve: the three outcome colours from the field. Two more only when a chart truly has five series.

## Components

Kit components take Almanac through the contract: paper and card grounds, terracotta primary, band secondary, hairline borders, 4px radius. The outlined button, the arch and the unit field are classes on authored elements: al-btn, al-arch, al-field.

- **Buttons.** Kit buttons on the left; authored al-btn on the right: a 1px outline in ink that fills on hover, text in mono caps, a wide gap before the arrow. The filled variant is terracotta and there is one per view.
- **Tags.** Tags are mono caps with a hairline, square. Status tags carry a pip or a word with the colour.
- **Fields.** Fields are the card ground with a hairline; the focus ring is terracotta. Labels are mono caps.
- **Stat.** An outcome block: a hairline on top, the number enormous in the serif, the sentence under it, the share in small text. Three across on wide screens.
- **Callouts.** A callout is text between two hairlines, with a soft tint when it carries status. The text stays ink.
- **Chart.** Charts take green, terracotta and mauve in that order. Bars are flat; lines are ink at 2px; axes are hairlines.
- **Table.** Tables are ink on paper with hairline rows and serif figures; no container border.
- **Card.** A ticket: the card ground, a serif title, details between hairlines, two buttons. It casts the soft shadow only when it opens as a dialog.

```jsx
<Button>Book a place</Button><Button variant="secondary">Read the story</Button><Button variant="outline">Follow the batch</Button><Button variant="ghost">Skip</Button><button className="al-btn al-btn-fill">Book a place</button><button className="al-btn">Follow the batch ↓</button>
<Badge>Kept</Badge><Badge variant="secondary">Band</Badge><Badge variant="outline">Outline</Badge><Badge variant="destructive">Lost</Badge><span className="al-tag">Field notes</span><span className="al-tag al-tag-ink">Kept</span><span className="al-tag al-tag-accent">Parts</span><span className="al-tag al-tag-positive">● Returned</span>
<div className="al-outcome"><span className="t-numeral-xl"><Number data="$totals" col="kept" /></span><h3 className="t-title">get another everyday.</h3><p className="t-body-s">of 100 · back in use</p></div><div className="al-outcome"><span className="t-numeral-xl al-accent"><Number data="$totals" col="parts" /></span><h3 className="t-title">help another along.</h3><p className="t-body-s">of 100 · donor parts</p></div>
<Alert><AlertTitle>A fictional workshop story</AlertTitle><AlertDescription>The batch is invented; every figure is shown as arithmetic.</AlertDescription></Alert><div className="al-callout"><strong>Note.</strong> A fact about the batch, set between two hairlines.</div><div className="al-callout al-callout-positive"><strong>Booked.</strong> Your place on Saturday is held.</div><div className="al-callout al-callout-negative"><strong>No places left.</strong> The next workshop opens on the 24th.</div>
<div className="al-ticket"><h3 className="t-display-m">Saturday workshop</h3><p className="t-body-s al-muted">Repair with us · places are free</p><div className="al-ticket-details"><span className="t-label">Date</span><span className="t-label">Sat 10 Oct · 10:00</span></div><div className="al-ticket-details"><span className="t-label">Places</span><span className="t-label"><Number data="$totals" col="places_left" /> of 20 left</span></div><div className="ds-row"><button className="al-btn al-btn-fill">Book a place</button><button className="al-btn">Details</button></div></div>
```

Classes the runtime provides: `h-num`, `al-paper`, `al-card`, `al-band`, `al-shadow`, `al-fill`, `al-fill2`, `al-muted`, `al-outline`, `al-line`, `al-num`, `al-mono`, `al-serif-i`, `al-serif-t`, `al-btn-o`, `al-btn-f`, `al-on-fill`, `al-btn`, `al-btn-fill`, `al-tag`, `al-tag-ink`, `al-tag-accent`, `al-tag-positive`, `al-outcome`, `al-accent`, `al-mauve`, `al-callout`, `al-callout-positive`, `al-callout-negative`, `al-ticket`, `al-ticket-details`, `al-nav`, `al-wordmark`, `al-hero`, `al-hero-h`, `al-hero-p`, `al-scroll`, `al-arch`, `al-device`, `al-device-n`, `al-device-m`, `al-hero-cap`, `al-outcomes`, `al-breakdown`, `al-total-bar`, `al-r60`, `al-r25`, `al-r15`, `al-eq`.

## The hand

Flat ink, hairline edges, a shadow you can see through. Almanac draws any subject with flat fills in green and terracotta, 1.5px ink outlines with round caps, and a terracotta shadow at 12% slipped 6px behind the main body. Small things are rounded; big panels get an arch. No gradients, no texture; the warmth comes from the paper and the ink.

| Rule | How |
|---|---|
| Stroke | 1.5px forest green, round caps and joins. |
| Fill | Flat green for the main share, terracotta for the second, paper-sunk for the rest. |
| Shadow | Terracotta at 12%, offset 6px, only behind the main body. |
| Corner | Small shapes 4–6px or pill; panels arched 180px at the top. |
| Figures | DM Mono caps at 11px; Instrument Serif for the one number. |
| Motion | The drawing may float once or tilt 12° and straighten on hover. |

Drawing mode `flat`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-shadow`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Three devices from the field guide: a panel that holds one thing, a hundred small shapes that show a share, and a card whose details sit between hairlines. Each is drawn with the hand variables, so it ports.

- **The arch.** A panel with a 180px rounded top on the band ground, one object centred inside, the soft shadow slipped behind. Use it for the hero device, a figure, or one big number.
- **The unit field.** One hundred small rounded shapes in a grid, coloured by outcome in green, terracotta and outline. Each shape is one of something; the caption says what.
- **The ticket.** A card with a serif title, details between two hairlines, and an outlined button that fills on hover. Dialogs, bookings, summaries.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Dense operational dashboards, dev tools, anything that must feel fast or cold, and pages that need more than one accent per view.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · best

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.

```jsx
<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">Field notes / 002</p>
  <h3 className="t-display-l ds-tpl-ed-h">Life, after low battery.</h3>
  <p className="ds-tpl-deck">Some come back whole. Some give something of themselves. Every tool in the shed has a next destination, and this is how a hundred of them found theirs.</p>
  <p className="t-label ds-tpl-byline">Words and pictures: the shed · a fictional story</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">T</span>he shed takes in a hundred tools a season. Each one is assessed on a Saturday before its next path is decided: back on the shelf, into the parts drawer, or off to the recycler. Sixty come back whole after a clean and an oiling. Twenty-five give a motor or a battery to another tool. Fifteen are simply done, and they leave as clean metal.</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n"><Number data="$totals" col="kept" /></span><span className="t-label">Tools kept, of 100</span></div>
  </div>
</div>
```

### Scrolly · best

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand.

```jsx
<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps"><div className="ds-tpl-step"><span className="t-label">01</span><h4 className="t-title">One batch, one hundred possibilities.</h4><p>A hundred tools arrive over a season. Each small shape is one of them; nothing is decided yet.</p></div><div className="ds-tpl-step"><span className="t-label">02</span><h4 className="t-title">Sixty get another everyday.</h4><p>They come back whole: cleaned, oiled, reshelved. Their story continues as complete tools.</p></div></div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">{/* draw this screen in the hand */}</div><p className="t-label ds-tpl-figure-cap">Batch / 001 · each shape is one tool · illustrative</p></div>
</div>
```

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Dense operational dashboards, dev tools, anything that must feel fast or cold, and pages that need more than one accent per view.

### App · good

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Classes the specimen uses: `ds-tpl-app`, `ds-tpl-bar`, `ds-tpl-brand`, `ds-tpl-bar-end`, `al-btn`, `al-btn-fill`, `ds-tpl-rows`, `ds-tpl-row`, `ds-tpl-row-name`, `ds-tpl-row-meta`, `ds-tpl-tag`, `is-ok`, `is-warn`, `is-bad`, `is-idle`, `ds-tpl-form`.

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">The lending shed</p><h3 className="t-display-xl ds-tpl-hero-h">Borrow the drill. Keep the weekend.</h3><p className="ds-tpl-hero-sub">Four hundred tools, one shed, and a Saturday workshop where things get fixed instead of replaced. Free to join.</p><div className="ds-row"><button className="al-btn al-btn-fill">Find the shed</button><button className="al-btn">Follow a tool</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Borrow</h4><p>Any tool for a week. Bring it back on a Saturday.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Fix</h4><p>Workshops every Saturday, places are free, tea is on.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Pass on</h4><p>A tool that is done gives its parts to the next one.</p></div></div>
</div>
```

## Do and don't

- One terracotta word per headline; the rest stays green.
- Hairlines above blocks, never boxes around them.
- Numbers enormous in the serif, with the sentence underneath.
- Hold one thing in an arch; leave the rest on the paper.

Don't:

- No bold serif (there is none); emphasis is the italic.
- No blue, no second red; mauve is a chart series only.
- No drop shadows except the terracotta one at 12%.
- No more than one filled button per view.

## What has no slot

The arch, the translucent offset shadow, the hairline-at-a-quarter rule, the band and screen grounds, and the unit field have no contract slot. They are carried as --ds-* properties and the al-* classes above; kit components take paper, ink and terracotta but stay square.
