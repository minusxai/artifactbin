---
name: system-broadsheet
kind: data
description: >-
  Broadsheet, a design system for artifactbin: Set it like it happened. Editorial; for features, reports, newsletters, long reads. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Broadsheet.** A front page, not a web page. Broadsheet sets a feature the way a newspaper would: a blackletter masthead between rules, a bold serif headline with one red word, an italic deck, body in columns with a drop cap, engraved plates for pictures, and figures pulled into the margin. The reader gets a document that feels reported.

- **Use it for:** Features and long reads, pilot reports, newsletters and digests, anything that benefits from the authority of print and the rhythm of columns.
- **Avoid it when:** Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.
- **Fit:** Dashboard avoid · Deck avoid · Editorial best · Scrolly good · Plan avoid · App avoid · Landing avoid.
- **Fonts:** UnifrakturCook · Old Standard TT · Libre Franklin · Courier Prime, every weight the roles use, served by the runtime. Opens day first.

## Bind it

1. Fence: `theme: broadsheet`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container text-foreground">`, then kit components, token classes and the classes below. Keep layout wrappers transparent: the runtime paints the system's page ground, including textures. Use an opaque surface only for a deliberate panel or section; a blanket `bg-background` hides that ground.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Broadsheet · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-red: #0a7f5a; } .dark { --ds-red: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-masthead` | masthead · clamp(40px, 7vw, 84px)/1 · 700 | The masthead, once, centred, between a double rule. Blackletter is for the name only. |
| `t-display-xl` | display · clamp(44px, 6.5vw, 80px)/1 · 700 | The headline. Old Standard bold; the second line may carry the one red word. |
| `t-display-l` | display · clamp(30px, 4vw, 48px)/1.08 · 700 | Section heads and crossheads. |
| `t-deck` | display · clamp(19px, 2.2vw, 24px)/1.35 · 400 | The deck under the headline. Italic Old Standard. |
| `t-body` | sans · 17px/27px · 400 | Body text, in columns where the width allows. A drop cap opens the piece. |
| `t-small` | franklin · 11px/15px · 600 | Datelines, figure labels, folios, the small print. Franklin caps. |
| `t-numeral` | display · clamp(44px, 6vw, 72px)/.95 · 700 | Pull figures, set large in the margin with a Franklin caption. |
| `t-wire` | mono · 13px/20px · 400 | Wire copy, tables of figures, datelines in the old style. Courier Prime. |

## Colour

Day is newsprint: warm off-white, black ink, hairline rules, one red. Night is the night edition: a near-black warm ground, cream ink, the red lifted. Status colours live in ledgers only; on the page, red is the only colour.

| Token | Use |
|---|---|
| `--ds-newsprint` | Page ground: newsprint by day; the late edition by night. |
| `--ds-newsprint-raised` | Boxes, plates, fields. |
| `--ds-newsprint-sunk` | Tint boxes, the classifieds, code. |
| `--ds-line` | Column rules and hairlines. |
| `--ds-ink` | Printer’s ink: text, rules, the masthead. |
| `--ds-ink-muted` | Secondary text, datelines, the small print. |
| `--ds-red` | One ranunculus red: the second word in a headline, the pull figure, the link. Never a fill larger than a word. |
| `--ds-on-red` | Text on red fills (rare). |
| `--ds-red-soft` | Ground for the one tinted box per page. |
| `--ds-positive` | Continued, approved. In the ledger only. |
| `--ds-positive-soft` | Ground for positive rows. |
| `--ds-caution` | Provisional, small sample. |
| `--ds-caution-soft` | Ground for caveats. |
| `--ds-negative` | Declined, failed. Shares the red. |
| `--ds-negative-soft` | Ground for negative rows. |

Chart series order: ink, red, ink-muted, line, positive. Charts are printed in ink with the exception in red. Hatching or a lighter ink separates series; never a third hue. Direct labels in Franklin caps; no legend boxes.

## Components

Kit components take Broadsheet through the contract: newsprint grounds, red primary, zero radius, hairline borders. Authored classes add the rules, the plate frame, the pull figure and the drop cap.

- **Buttons.** Kit buttons left; authored bs-btn right: Franklin caps in a 1px ink frame; the primary fills red, used once per page at most.
- **Tags.** Tags are Franklin caps in a hairline frame, like a section flag. Caveats take caution.
- **Fields.** Fields are newsprint wells with a 1px ink rule below, like a coupon. Focus is a red outline.
- **Stat.** A Stat is a pull figure: a large serif number with its caption in Franklin caps, set in the margin or between columns. The one red figure names its denominator.
- **Callouts.** Callouts are boxed notes with a bold lead word, in the body face. Caveats take caution; the decision takes the red rule.
- **Chart.** Charts are ink with one red exception, labelled directly. Title the figure with a Fig. number in Franklin caps.
- **Table.** Tables are the record: Courier figures, hairline rows, Franklin caps headers. Status is a word in the last column.
- **Card.** A card is a plate: an engraving in a 1px frame with a Fig. caption below in Franklin caps. The engraving is hatched ink, never a photograph.

```jsx
<Button>Read the full report</Button><Button variant="secondary">Subscribe</Button><Button variant="outline">Method</Button><Button variant="ghost">Skip</Button><button className="bs-btn bs-btn-primary">Read the full report</button><button className="bs-btn">The method</button>
<Badge>Red</Badge><Badge variant="secondary">Tinted</Badge><Badge variant="outline">Illustrative</Badge><Badge variant="destructive">Declined</Badge><span className="bs-tag">Autumn edition</span><span className="bs-tag bs-tag-red">Pilot report</span><span className="bs-tag bs-tag-caution">Small sample</span>
<div className="bs-pull"><span className="t-numeral">510</span><span className="t-small">purchase transactions · six Sundays</span></div><div className="bs-pull"><span className="t-numeral bs-red">26<span className="bs-of"> of 42</span></span><span className="t-small">respondents preferred the earlier opening</span></div>
<Alert><AlertTitle>Transactions are not shoppers</AlertTitle><AlertDescription>510 purchases were recorded; one person may account for several.</AlertDescription></Alert><div className="bs-box"><strong>Editor’s note.</strong> Scenes marked illustrative are composed from the committee’s notes, not from interviews.</div><div className="bs-box bs-box-caution"><strong>Small sample.</strong> 42 responses from several hundred visitors. Read 26 of 42 as a lean, not a verdict.</div><div className="bs-box bs-box-red"><strong>Decision.</strong> The committee continues the 5 a.m. opening through November and reviews in December.</div>
<div className="bs-plate-box"><div className="bs-plate-art"><svg viewBox="0 0 320 200"><title>An engraved bouquet in a bucket</title><g className="bs-engrave"><rect x="120" y="120" width="80" height="60"/><line x1="128" y1="120" x2="128" y2="180"/><line x1="136" y1="120" x2="136" y2="180"/><line x1="144" y1="120" x2="144" y2="180"/><line x1="152" y1="120" x2="152" y2="180"/><line x1="160" y1="120" x2="160" y2="180"/><line x1="168" y1="120" x2="168" y2="180"/><line x1="176" y1="120" x2="176" y2="180"/><line x1="184" y1="120" x2="184" y2="180"/><line x1="192" y1="120" x2="192" y2="180"/><path d="M160 120 c0 -30 -6 -60 4 -90"/><path d="M164 60 c-16 -14 -34 -6 -38 10 c12 10 28 6 38 -10 z"/><path d="M164 60 c16 -14 34 -6 38 10 c-12 10 -28 6 -38 -10 z"/><path d="M164 60 c-6 -22 4 -40 20 -44 c4 18 -4 36 -20 44 z"/><path d="M140 100 c-14 -2 -24 10 -22 20 c12 2 22 -8 22 -20 z"/><path d="M184 90 c14 -2 24 10 22 20 c-12 2 -22 -8 -22 -20 z"/><circle cx="164" cy="60" r="5"/></g></svg></div><p className="t-small bs-caption"><b>Fig. 2</b> · Buckets filled by torchlight. A grower who used to set up at seven is already stacking stems. Illustrative.</p></div>
```

Classes the runtime provides: `bs-paper`, `bs-plate`, `bs-masthead`, `bs-head`, `bs-deck`, `bs-rule`, `bs-rule-thin`, `bs-col`, `bs-small`, `bs-muted-fill`, `bs-red-fill`, `bs-engrave`, `bs-engrave-c`, `bs-tick`, `bs-hand`, `bs-roman`, `bs-red-wedge`, `bs-spec`, `bs-spec-red`, `bs-pull-f`, `bs-red`, `bs-of`, `bs-btn`, `bs-btn-primary`, `bs-tag`, `bs-tag-red`, `bs-tag-caution`, `bs-pull`, `t-small`, `bs-box`, `bs-box-caution`, `bs-box-red`, `bs-plate-box`, `bs-plate-art`, `bs-caption`, `bs-mast`, `bs-double`, `bs-dateline`, `bs-columns`, `bs-body`, `bs-dropcap`, `bs-aside`, `bs-record`, `bs-record-h`, `bs-rec-row`, `bs-rec-v`, `bs-folio`, `bs-sample-bottom`, `bs-sample`, `bs-sample-grid`, `bs-masthead-lg`, `bs-deck-sm`, `bs-dropcap-svg`, `bs-wire-t`, `bs-col-rule`, `h-text`, `h-num`, `h-tex-fill2`.

## The hand

An engraver’s line: hairlines, a line-screen for every tone. Broadsheet draws like a plate: 1.5px ink lines with square ends, and no flat tone anywhere. A filled region is a horizontal line-screen at a 4px pitch, in red for the one thing that matters and in ink for the rest; the quiet parts stay newsprint. Frame it, caption it with a Fig. number, mark it illustrative if it is.

| Rule | How |
|---|---|
| Stroke | 1.5px ink, square caps. Hairlines, never heavy. |
| Fill | None. Tone is a horizontal line-screen, 4px pitch: red for the subject, ink for the rest. |
| Shadow | None. Ink on paper. |
| Texture | The line-screen is the texture; the plate frame is the only ornament. |
| Figures | Old Standard bold for the one number; Franklin caps for the caption. |
| Motion | A plate may draw itself in on first view. Nothing else moves. |

Drawing mode `engrave`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hand-tex`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Broadsheet draws with the furniture of a front page. The data lives in pull figures, in box scores and in engraved plates whose details are the counts: one specimen per unit of the sample.

- **The masthead.** Blackletter name centred between a 2px-over-1px double rule, with the edition, the subject and the price in Franklin caps on the rule below. Once per page.
- **The specimen count.** One engraved specimen per unit of the sample, the agreeing ones in red: 26 of 42 without a legend. Swap the specimen for the subject (stems, coins, keys); keep the count honest.
- **The pull figure.** A large serif number set between columns with a Franklin caption; the one red figure carries its denominator in the same breath.
- **The box score.** A tally set like a sports box: Franklin caps head, Courier figures, hairline rows, a double rule above. For any small table of record: votes, takings, the pilot by week.
- **The jump line and the folio.** "Continued on page 4" in Franklin caps closes a column that breaks; the folio (name · page) sits above the bottom double rule. They tell the reader the page has an edge.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.

### Deck · avoid

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Expect custom CSS: Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.

### Editorial · best

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.

```jsx
<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">The early-opening pilot</p>
  <h3 className="t-display-l ds-tpl-ed-h">The market before sunrise</h3>
  <p className="ds-tpl-deck">Six Sundays of 5 a.m. flowers left the committee with 510 sales, 42 opinions and a $1,800 bill. Is that enough to keep the lights on early?</p>
  <p className="t-label ds-tpl-byline">Saltmarsh, Sunday · from the committee’s notes</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">B</span>efore the first tram, before the bakeries lift their shutters, there is a particular smell at the market: cold water, cut stems, diesel from the delivery vans. For six Sunday mornings this autumn residents could walk into it. The pilot opened the stalls at five and closed them at nine, and the committee must now decide whether that window stays.</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n"><Number data="$totals" col="cost" prefix="$" format=",.0f" /></span><span className="t-label">Additional staffing</span></div>
  </div>
</div>
```

### Scrolly · good

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Classes the specimen uses: `ds-tpl-scrolly`, `ds-tpl-steps`, `ds-tpl-step`, `t-label`, `t-title`, `ds-tpl-figure`, `ds-tpl-figure-art`, `h-tex`, `h-tex-fill`, `h-tex-fill2`, `h-muted`, `h-ink`, `h-num`, `h-text`, `ds-tpl-figure-cap`.

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.

### Landing · avoid

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Expect custom CSS: Interactive tools, dashboards, anything scanned rather than read, or subjects that need colour to carry meaning.

## Do and don't

- Set the masthead once, in blackletter, between a double rule.
- Run body in columns with hairline rules; open with a drop cap.
- One red word per page; pull figures name their denominator.
- Use engraved plates with Fig. captions; label invented scenes illustrative.

Don't:

- No photographs; no colour fills larger than a tint box.
- No rounded corners, shadows or gradients.
- No blackletter anywhere but the masthead.
- No percentage without its base in the same sentence.

## What has no slot

The masthead face, the Franklin small-caps role, the column rules, the plate frame and the drop cap have no contract slot; they are bs-* classes. The contract names three families; Broadsheet uses four, so UnifrakturCook and Libre Franklin are set by class.
