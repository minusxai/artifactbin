---
name: system-sorbet
kind: data
description: >-
  Sorbet, a design system for artifactbin: Candy colours, plum ink, one spring. Fun; for consumer apps, launches, kids and food, celebrations, playful data. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Sorbet.** A sheet of stickers, peeled onto the page. Sorbet is pop: five candy colours on cream, every shape die-cut with a plum outline, a white rim and a hard drop, like stickers on a lunchbox. Headlines are chunky, corners are fat, and exactly one thing springs when you touch it. The colours do the shouting, so the words never have to.

- **Use it for:** Consumer apps and launches, kids and food subjects, events and celebrations, playful counters, pickers and polls, anything that should feel like a good day.
- **Avoid it when:** Serious, institutional or grieving subjects, dense data, long reading, or any page where candy would read as not listening.
- **Fit:** Dashboard good · Deck good · Editorial avoid · Scrolly good · Plan avoid · App best · Landing best.
- **Fonts:** Fredoka · Nunito · DM Mono, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: sorbet`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container text-foreground">`, then kit components, token classes and the classes below. Keep layout wrappers transparent: the runtime paints the system's page ground, including textures. Use an opaque surface only for a deliberate panel or section; a blanket `bg-background` hides that ground.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Sorbet · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-strawberry: #0a7f5a; } .dark { --ds-strawberry: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(48px, 8vw, 104px)/.95 · 700 | One per page. Fredoka bold; one word may sit on a sticker. |
| `t-display-l` | display · clamp(32px, 4.5vw, 56px)/1.02 · 700 | Section openers. |
| `t-title` | display · 24px/28px · 600 | Card titles, sticker words. |
| `t-body` | sans · 17px/27px · 400 | Reading and UI text. Nunito, round and soft. |
| `t-body-s` | sans · 14px/20px · 400 | Captions and helper text. |
| `t-label` | display · 12px/16px · 600 | Eyebrows, tags, sticker text. Fredoka caps. |
| `t-numeral` | display · 52px/52px · 700 | Counts and prices. Fredoka bold, tabular. |
| `t-mono` | mono · 13px/20px · 400 | Ticket numbers, timestamps, receipts. |

## Colour

Day is cream white with the candies at full saturation and plum ink. Night is the parlour after close: deep plum walls, cream-pink ink, the candies unchanged so stickers glow. Status text is darkened on cream so lime, mango and strawberry words stay readable; on night the candies serve as text directly.

| Token | Use |
|---|---|
| `--ds-cream` | Page ground: cream white by day; the night parlour, deep plum, after dark. |
| `--ds-cream-raised` | Cards, stickers, fields. |
| `--ds-cream-sunk` | Wells, the sprinkle band ground, code. |
| `--ds-line` | Soft rules. Never the edge of a sticker; stickers use ink. |
| `--ds-ink` | Plum ink: text, the 3px sticker outline, the hard drop. Never black. |
| `--ds-ink-muted` | Secondary text and captions. |
| `--ds-rim` | The sticker rim: a 3px halo outside the ink outline, like a die-cut sticker. |
| `--ds-strawberry` | The brand. Primary actions, the hero blob, the first chart series. |
| `--ds-on-strawberry` | Text on strawberry. |
| `--ds-strawberry-soft` | Ground for selected rows and the strawberry tag. |
| `--ds-mango` | The second candy: NEW stickers, prices, the sun. |
| `--ds-lime` | The third candy: done, fresh, yes. |
| `--ds-blueberry` | The fourth candy: links, focus, the second chart series. |
| `--ds-on-blueberry` | Text on blueberry. |
| `--ds-grape` | The fifth candy: the fifth series, a sprinkle. |
| `--ds-lilac` | The quiet fill: muted shapes in drawings, the inactive track. |
| `--ds-positive` | Done, fresh, yes. Lime as text is darkened on cream. |
| `--ds-positive-soft` | Ground for done rows and positive tags. |
| `--ds-caution` | Almost, low, soon. Mango as text is darkened on cream. |
| `--ds-caution-soft` | Ground for caveats. |
| `--ds-negative` | Sold out, oops, no. Strawberry as text is darkened on cream. |
| `--ds-negative-soft` | Ground for sold-out rows. |

Chart series order: strawberry, blueberry, mango, lime, grape. The five candies in order. Rounded bar ends, no gridlines heavier than the soft rule, direct labels where they fit.

## Components

Kit components take Sorbet through the contract: cream grounds, strawberry primary, 20px radius, soft rules. Authored classes add the outline, the rim, the drop and the spring: sb-sticker on a card, sb-btn on a button.

- **Buttons.** Kit buttons left; authored sb-btn right: pills with the outline, rim and drop. The primary is strawberry, mango is for the one new thing. Press for the spring.
- **Tags.** Tags are candy pills with an ink outline. The sticker chip is rotated 6° with the rim and drop: one per view, for the newest thing.
- **Fields.** Fields are cream pills with the 3px outline; focus is a blueberry outline. Labels are Fredoka caps.
- **Stat.** A Stat is a sticker card: Fredoka label, a big figure, the small print. The scoop stack under a rating is one scoop per point, in candy order.
- **Callouts.** Callouts are speech bubbles: a sticker with a tail, a bold lead word, one sentence. Lime for yes, mango for almost, strawberry for no.
- **Chart.** Charts are the candies in order with rounded bar ends. For counts under ten, prefer a scoop stack to a bar.
- **Table.** Tables are the stall list: Fredoka names, DM Mono counts, soft rules, a candy tag in the last column.
- **Card.** A card is a sticker: outline, rim, drop, and one chip peeled onto its corner. Titles are Fredoka; facts are Nunito.

```jsx
<Button>Grab a ticket</Button><Button variant="secondary">Save a stall</Button><Button variant="outline">See the map</Button><Button variant="ghost">Not now</Button><button className="sb-btn sb-btn-primary">Grab a ticket</button><button className="sb-btn sb-btn-mango">New this week</button><button className="sb-btn">See the map</button>
<Badge>Strawberry</Badge><Badge variant="secondary">Saved</Badge><Badge variant="outline">Free</Badge><Badge variant="destructive">Sold out</Badge><span className="sb-tag sb-tag-straw">Food</span><span className="sb-tag sb-tag-blue">Music</span><span className="sb-tag sb-tag-mango">Craft</span><span className="sb-tag sb-tag-lime">Open</span><span className="sb-sticker-chip">New!</span>
<div className="sb-stat sb-sticker"><span className="t-label">Visitors</span><span className="t-numeral"><Number data="$totals" col="visitors" format=",.0f" /></span><span className="sb-small">this weekend · 12 stalls</span></div><div className="sb-stat sb-sticker sb-stat-mango"><span className="t-label">Happy rating</span><span className="t-numeral"><Number data="$totals" col="rating" format=".1f" /></span><div className="sb-scoops"><i className="sb-scoop sb-f-straw"></i><i className="sb-scoop sb-f-blue"></i><i className="sb-scoop sb-f-mango"></i><i className="sb-scoop sb-f-lime"></i><i className="sb-scoop sb-f-grape"></i></div></div>
<Alert><AlertTitle>Churros are gone for today</AlertTitle><AlertDescription>The stall sold 310 by noon. Try the waffles two stalls down.</AlertDescription></Alert><div className="sb-bubble sb-bubble-lime"><strong>Open now.</strong> The food court is serving until six.</div><div className="sb-bubble sb-bubble-mango"><strong>Almost.</strong> Twelve craft tickets left for the 2 pm slot.</div><div className="sb-bubble sb-bubble-straw"><strong>Gone.</strong> The 4 pm band is full. The 6 pm set has room.</div>
<div className="sb-card sb-sticker"><span className="sb-sticker-chip sb-card-chip">New!</span><p className="t-label">Stall 07</p><h3 className="t-title">Churro Bros</h3><p className="sb-card-p">Cinnamon churros, chocolate dip, a queue by eleven. Sold 310 last Saturday and ran out at noon.</p><div className="sb-row"><span className="sb-tag sb-tag-straw">Food</span><button className="sb-btn sb-btn-primary sb-btn-sm">Save stall</button></div></div>
```

Classes the runtime provides: `h-num`, `h-plate`, `h-text`, `sb-cream`, `sb-f-straw`, `sb-f-mango`, `sb-f-lime`, `sb-f-blue`, `sb-f-grape`, `sb-shadow`, `sb-rim`, `sb-outline`, `sb-wave`, `sb-sticker-t`, `sb-on-blue`, `sb-cover-word`, `sb-blob-t`, `sb-blob-n`, `sb-muted`, `sb-word`, `sb-sticker`, `sb-btn`, `sb-btn-primary`, `sb-btn-mango`, `sb-btn-sm`, `sb-tag`, `sb-tag-straw`, `sb-tag-blue`, `sb-tag-mango`, `sb-tag-lime`, `sb-sticker-chip`, `sb-stat`, `sb-stat-mango`, `t-label`, `sb-small`, `sb-scoops`, `sb-scoop`, `sb-bubble`, `sb-bubble-lime`, `sb-bubble-mango`, `sb-bubble-straw`, `sb-dot`, `sb-card`, `sb-card-chip`, `sb-card-p`, `sb-row`, `sb-row-start`, `sb-hero`, `sb-hero-chip`, `sb-sample-h`, `sb-sample-lede`, `sb-hero-art`, `sb-stalls`, `sb-stall`, `sb-center`, `sb-sample`, `sb-sample-bottom`.

## The hand

Fat outlines, flat candy, a hard drop. Sorbet draws like a sticker sheet: every shape gets a 3px plum outline with round caps, flat candy fills, a hard 6px drop, and nothing else. No gradients, no texture, no thin lines. Whatever the artifact is about, draw it as a sticker.

| Rule | How |
|---|---|
| Stroke | 3px ink, round caps and joins, on every shape. |
| Fill | Flat candy: strawberry first, blueberry second; lilac for quiet parts. |
| Shadow | A hard 6px drop in ink under the main body. No blur. |
| Rim | Big stickers get a 3px white rim outside the outline. Small ones do not. |
| Figures | Fredoka bold for the one number; DM Mono caps for labels. |
| Motion | A drawing may float (one per page) or spring on hover; it never fades in. |

Drawing mode `flat`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-shadow`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-shadow`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Sorbet draws with the sticker sheet. The data lives in the stickers: a count is a stack of scoops, a share is a row of candy dots, the new thing wears the chip.

- **The sticker.** Any shape, outlined 3px in ink, with a white rim and a hard drop. Rotate a chip 6° to make it feel peeled on. One rotated chip per view.
- **The blob and the sprinkles.** An organic rounded panel in one candy as a hero ground, with a scatter of candy dashes as texture. Sprinkles go in bands, never over text.
- **The wavy rule.** Sections are divided by a wave, not a line: 8px amplitude, 40px wavelength, 3px ink. Fill the space below it in a candy for a band.
- **The speech bubble.** A callout is a sticker with a tail: a bold lead word, one sentence, in lime, mango or strawberry for yes, almost, no.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · good

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Classes the specimen uses: `ds-tpl-dash`, `ds-tpl-bar`, `ds-tpl-brand`, `t-label`, `ds-tpl-crumb`, `ds-tpl-bar-end`, `ds-tpl-kpis`, `ds-tpl-kpi`, `t-numeral`, `ds-tpl-delta`, `ds-tpl-dash-grid`, `ds-tpl-tile`.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Serious, institutional or grieving subjects, dense data, long reading, or any page where candy would read as not listening.

### Scrolly · good

Template: scrolly. Chapters and their figures stay in ordinary document flow; the author supplies each chapter’s figure state and the system owns the step card and figure, drawn in its hand. Classes the specimen uses: `ds-tpl-scrolly`, `ds-tpl-steps`, `ds-tpl-step`, `t-label`, `t-title`, `ds-tpl-figure`, `ds-tpl-figure-art`, `h-fill`, `h-fill2`, `h-muted`, `h-ink`, `h-num`, `h-text`, `ds-tpl-figure-cap`.

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Serious, institutional or grieving subjects, dense data, long reading, or any page where candy would read as not listening.

### App · best

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.

```jsx
<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">Scoop</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="Find a stall" value="$pick" /><button className="sb-btn sb-btn-primary">Add a stall</button></div></div>
  <div className="ds-tpl-rows"><div className="ds-tpl-row"><span className="ds-tpl-row-name">Food court</span><span className="ds-tpl-row-meta">5 stalls · open 10–6</span><span className="ds-tpl-tag is-ok">Open</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Craft tent</span><span className="ds-tpl-row-meta">4 stalls · 12 tickets left</span><span className="ds-tpl-tag is-warn">Almost</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Bandstand</span><span className="ds-tpl-row-meta">4 pm set</span><span className="ds-tpl-tag is-bad">Full</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">Kids corner</span><span className="ds-tpl-row-meta">Opens at 2 pm</span><span className="ds-tpl-tag is-idle">Later</span></div></div>
  <div className="ds-tpl-form"><Select label="Stall" value="$pick" options={["Sat", "Sun", "Both"]} /><Switch label="Only open stalls" checked="$flag" /><button className="sb-btn">Save</button></div>
</div>
```

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">Scoop · weekend markets</p><h3 className="t-display-xl ds-tpl-hero-h">Weekends, but louder.</h3><p className="ds-tpl-hero-sub">Find the stalls, grab a ticket, skip the queue. Every market in the city, one sticker sheet.</p><div className="ds-row"><button className="sb-btn sb-btn-primary">Grab a ticket</button><button className="sb-btn">See the map</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Free tickets</h4><p>Claim a slot for the busy stalls; the churros are still not free.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Live counts</h4><p>See which stalls are open, almost full, or gone for today.</p></div><div className="ds-tpl-feat"><h4 className="t-title">One sticker sheet</h4><p>Every market you follow, peeled onto one page.</p></div></div>
</div>
```

## Do and don't

- Outline, rim, drop: every content shape is a sticker.
- Plum ink, never black; candies at full saturation.
- Pills for controls, 20px for cards, waves for dividers.
- One spring per touch; one floating hero; one rotated chip per view.

Don't:

- No black text, no grey grounds, no thin lines.
- No gradients, no blur, no confetti.
- No more than one exclamation mark per page.
- No candy as body text on cream; status words use the darkened variants.

## What has no slot

The sticker outline, rim and drop, the spring easing, the wave, the speech bubble tail and the scoop stack have no contract slot; they are sb-* classes, the --ds-sticker and --ds-spring properties and inline SVG. Lilac rides the accent slot so kit components get the quiet fill.
