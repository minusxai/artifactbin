---
name: system-riso
kind: data
description: >-
  Riso, a design system for artifactbin: Three inks, one key plate, a hair out of register. Printed; for scrolly stories, picture-book explainers, posters, zines. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Riso.** Printed, not rendered. Riso is the print shop: three fluorescent inks laid one pass at a time over a navy key plate, each slipped by a hair, on uncoated paper with a grain you can feel. Headlines overprint themselves. Pages go full-bleed in one ink. Tags hang off things. It makes any subject feel like a picture book someone made by hand, and it is at its best when the story moves in chapters.

- **Use it for:** Scrolly stories and picture-book explainers, chaptered long reads, posters and zines, launch pages that want warmth with a spine.
- **Avoid it when:** Dense dashboards (three inks and a key cannot carry twelve series), institutional or legal subjects, anything that must look neutral, or long UI-heavy apps.
- **Fit:** Dashboard avoid · Deck good · Editorial good · Scrolly best · Plan avoid · App avoid · Landing best.
- **Fonts:** Fraunces · Space Mono, every weight the roles use, served by the runtime. Opens day first.
- **Published specimen:** `/a/XcH5C6` on the public artifactbin renders everything below in both modes. From: scrolly_opus-c (risograph picture book).

## Bind it

1. Fence: `theme: riso`, and the page type's `template`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Riso (XcH5C6) · base=<theme> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-blue: #0a7f5a; } .dark { --ds-blue: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(64px, 12vw, 160px)/.82 · 900 | One per page. The chapter word, the cover word. Soft, wonky, enormous. |
| `t-display-l` | display · clamp(40px, 6.4vw, 84px)/.9 · 900 | Section openers and plate titles. |
| `t-display-m` | display · 40px/40px · 900 | Tag titles, stat blocks, page titles. |
| `t-title` | display · 24px/28px · 900 | Card and step titles. |
| `t-deck` | display · clamp(20px, 2vw, 26px)/1.25 · 500 | The italic line under a headline, chapter subtitles, pull quotes. |
| `t-body-l` | sans · 20px/1.5 · 500 | Step cards and lead paragraphs. Fraunces at 500 reads at length. |
| `t-body` | sans · 17px/1.55 · 500 | Default reading and UI text. |
| `t-body-s` | sans · 14px/1.45 · 500 | Captions, imprints, helper text. |
| `t-label` | mono · 12px/16px · 400 | Eyebrows, folios, tag facts, running heads. Caps from CSS. |
| `t-numeral` | mono · 40px/44px · 700 | KPI figures and the numbers inside doors. Tabular. |
| `t-mono` | mono · 13px/20px · 400 | Code, IDs, table figures. |

## Colour

Paper first. Night is the ink page: the key plate becomes the ground, type goes paper, and the fluorescent inks stay fluorescent. Yellow is never text and never a line; it is a ground and a highlighter. Blue is the working ink: actions, the first series, headline colour. Pink is the slipped plate and the badge. Status colours exist for callouts and tags only and always come with a word.

| Token | Use |
|---|---|
| `--ds-paper` | Page ground: uncoated stock. In Night the key plate becomes the page. |
| `--ds-sheet` | Cards, step cards, proofs: a whiter sheet laid on the paper. |
| `--ds-paper-sunk` | Wells, code, inactive tracks, table stripes. |
| `--ds-manila` | Luggage tags and folio stock: physical card, the same in both modes. Text on it is on-yellow. |
| `--ds-line` | Hairlines and quiet borders. The 2px key edge is the real border. |
| `--ds-key` | The key plate: text, edges, hard shadows. Every other ink sits on top of it. |
| `--ds-key-2` | Secondary text, imprints, captions. |
| `--ds-blue` | Ink 1. Primary actions, the first series, the headline colour. |
| `--ds-on-blue` | Text on blue. |
| `--ds-blue-soft` | Ground for blue tags and selected rows. |
| `--ds-pink` | Ink 2. Fluorescent; the second series, the slipped plate behind a headline, badges. |
| `--ds-on-pink` | Text on pink. |
| `--ds-pink-soft` | Ground for pink tags and info callouts. |
| `--ds-yellow` | Ink 3. Highlighter and ticker ground; never text, never a line. |
| `--ds-on-yellow` | Text on yellow. |
| `--ds-positive` | Success text and the kept share, always with a word or a pip. |
| `--ds-positive-soft` | Ground for success callouts and positive tags. |
| `--ds-caution` | Warnings as text: a dark ochre on paper, the yellow itself at night. |
| `--ds-caution-soft` | Ground for warning callouts. |
| `--ds-negative` | Errors and the lost share. A printer’s red, not pink. |
| `--ds-negative-soft` | Ground for error callouts. |

Chart series order: blue, pink, yellow, key-2, positive. The three inks in print order, then the key at half strength, then green. Bars overprint (multiply) where they stack; lines are the key plate at 2px.

## Components

Kit components take Riso through the contract: paper and sheet grounds, blue primary, yellow secondary, pink ring, zero radius. The 2px key edge, the hard shadow and the turn are classes on authored elements: ri-card, ri-btn, ri-tag.

- **Buttons.** Kit buttons on the left; authored ri-btn on the right with the 2px key edge and the 6px slip. Blue is the primary. Pink is for the one playful action per page.
- **Tags.** Tags are mono caps inside a 2px key edge, square. Status tags carry a pip or a word with the colour.
- **Fields.** Fields are sheets with the key edge; the focus ring is pink. Labels are mono caps above the field.
- **Stat.** A door: the number printed big on one ink block with a halftone shadow, the label beside it. Three doors, three inks. Figures come from data.
- **Callouts.** A callout is a sheet with a dashed key rule and a folio in the corner. Status is the ground tint and the folio word; the text stays key.
- **Chart.** Charts take the inks in print order: blue, pink, yellow. Stacked bars overprint; no gradients; labels in mono.
- **Table.** Tables are key on sheet with hairline rows, mono figures, and the 2px edge on the container.
- **Card.** A step card: a sheet with the key edge, a 9px slip, a folio tab and a fraction of a turn. Highlights are a yellow bar behind the words, never a colour change.

```jsx
<Button>Turn the page</Button><Button variant="secondary">Pick this door</Button><Button variant="outline">Contents</Button><Button variant="ghost">Skip</Button><button className="ri-btn ri-btn-blue">Turn the page</button><button className="ri-btn ri-btn-pink">Stamp it</button><button className="ri-btn">Contents</button>
<Badge>Blue</Badge><Badge variant="secondary">Yellow</Badge><Badge variant="outline">Outline</Badge><Badge variant="destructive">Lost</Badge><span className="ri-tag">Chapter I</span><span className="ri-tag ri-tag-blue">Kept</span><span className="ri-tag ri-tag-pink">Parts</span><span className="ri-tag ri-tag-yellow">New</span><span className="ri-tag ri-tag-positive">● Returned</span>
<div className="ri-door ri-door-blue"><span className="ri-door-n t-display-m"><Number data="$totals" col="kept" /></span><div><span className="t-label">Kept</span><span className="ri-door-s">back on the street</span></div></div><div className="ri-door ri-door-pink"><span className="ri-door-n t-display-m"><Number data="$totals" col="parts" /></span><div><span className="t-label">Parts</span><span className="ri-door-s">into the drawers</span></div></div><div className="ri-door ri-door-yellow"><span className="ri-door-n t-display-m"><Number data="$totals" col="retired" /></span><div><span className="t-label">Retired</span><span className="ri-door-s">to the recycler</span></div></div>
<Alert><AlertTitle>Figures illustrative</AlertTitle><AlertDescription>The batch is fictional; the arithmetic is real.</AlertDescription></Alert><div className="ri-callout ri-callout-blue"><span className="ri-folio">Note</span><strong>Blue means the working ink.</strong> A fact about the batch, not an alarm.</div><div className="ri-callout ri-callout-positive"><span className="ri-folio">Done</span><strong>Printed.</strong> All three plates landed.</div><div className="ri-callout ri-callout-negative"><span className="ri-folio">Stop</span><strong>Plate 2 is out of register.</strong> Realign and print the proof again.</div>
<div className="ri-card"><span className="ri-folio">p. 6</span><h3 className="t-title">Dot, who was dropped</h3><p className="ri-card-body">Screen cracked corner to corner, everything else fine. Twenty minutes, one new screen, and <b className="ri-hl">Dot goes back through door one</b>.</p><button className="ri-btn ri-btn-blue">Follow Dot</button></div>
```

Classes the runtime provides: `ri-paper`, `ri-sheet`, `ri-manila`, `ri-proof`, `ri-blue`, `ri-pink`, `ri-yellow`, `ri-key`, `ri-mult`, `h-plate`, `ri-key-line`, `ri-dots-pink`, `ri-mono`, `ri-on-key`, `ri-on-manila`, `ri-navy`, `ri-on-navy`, `ri-ovp-t`, `ri-tag-h`, `ri-hole`, `ri-string`, `ri-tag-string`, `ri-btn`, `ri-btn-blue`, `ri-btn-pink`, `ri-tag`, `ri-tag-blue`, `ri-tag-pink`, `ri-tag-yellow`, `ri-tag-positive`, `ri-door`, `ri-door-n`, `ri-door-blue`, `ri-door-pink`, `ri-door-yellow`, `ri-door-s`, `ri-callout`, `ri-callout-blue`, `ri-callout-positive`, `ri-callout-negative`, `ri-folio`, `ri-folio-br`, `ri-hl`, `ri-card`, `ri-card-b`, `ri-card-body`, `ri-runhead`, `ri-cover`, `ri-cover-words`, `ri-kicker`, `ri-pip`, `ri-pip-blue`, `ri-h1`, `ri-h1-l1`, `ri-h1-l2`, `ri-ovp`, `ri-dek`, `ri-imprint`, `ri-turn`, `ri-cover-art`, `ri-cover-svg`, `ri-badge`, `ri-ticker`, `ri-ticker-track`, `ri-scene`, `ri-steps`, `ri-tagwrap`, `ri-tag-card`, `ri-dl`, `ri-stage`, `ri-fig`.

## The hand

Three plates, printed one after another. Riso draws any subject as a print: the fills go down first as colour plates (blue, pink), offset by 4px and multiplied where they cross, then the key plate draws every edge in 2px navy. No gradient, no blur, no rounded strokes; dots stand in for tone. The subject changes; the press does not.

| Rule | How |
|---|---|
| Key plate | 2px navy, round caps. Every edge, drawn last, slightly off the fill. |
| Colour plates | Flat blue and pink, multiplied. Yellow only as a ground or a highlight. |
| Register | Fills slip 4px right and 3px down from the key. The slip is constant across a page. |
| Tone | Halftone dots at a 9px pitch, masked to a corner. No gradients. |
| Figures | Space Mono caps at 11px; the display face for the one big number. |
| Grain | Fractal-noise grain over covers and plates at 40% multiply. |

Drawing mode `riso`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

The devices are the print shop’s: a word printed three times, a tag that hangs off a fact, a figure framed as a proof. Each is drawn with the hand variables, so it ports.

- **The overprint word.** A headline printed three times: yellow, then pink, then blue, each pass off by .03–.045em and multiplied. Use it on one word per page: the chapter word or the number.
- **The luggage tag.** A manila tag with a punched hole and a string. It carries a name and three mono facts; it turns ±2° and casts the hard shadow. One tag per thing introduced.
- **The proof.** A figure in a sheet frame, turned a degree, with a Fig. caption below and the ink chips beside it. Any chart or drawing becomes a proof when it needs a frame.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Dense dashboards (three inks and a key cannot carry twelve series), institutional or legal subjects, anything that must look neutral, or long UI-heavy apps.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · good

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Classes the specimen uses: `ds-tpl-ed`, `t-label`, `ds-tpl-kicker`, `t-display-l`, `ds-tpl-ed-h`, `ds-tpl-deck`, `ds-tpl-byline`, `ds-tpl-ed-cols`, `ds-tpl-ed-body`, `ds-tpl-dropcap`, `ds-tpl-pull`, `t-numeral`, `ds-tpl-pull-n`.

### Scrolly · best

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand.

```jsx
<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps"><div className="ds-tpl-step"><span className="t-label">01</span><h4 className="t-title">Five hundred bikes on the floor.</h4><p>Each square is one bike; the ink is the door it will leave by. Nothing is decided yet.</p></div><div className="ds-tpl-step"><span className="t-label">02</span><h4 className="t-title">Three doors.</h4><p>Blue goes back to the docks, pink to the parts drawers, the pale ones to the recycler.</p></div></div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">{/* draw this screen in the hand */}</div><p className="t-label ds-tpl-figure-cap">Fig. 1 · One batch by door · illustrative</p></div>
</div>
```

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Dense dashboards (three inks and a key cannot carry twelve series), institutional or legal subjects, anything that must look neutral, or long UI-heavy apps.

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Dense dashboards (three inks and a key cannot carry twelve series), institutional or legal subjects, anything that must look neutral, or long UI-heavy apps.

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">The Depot</p><h3 className="t-display-xl ds-tpl-hero-h">Every bike gets a second life.</h3><p className="ds-tpl-hero-sub">Drop it at any dock. We tag it, fix it or part it out, and tell you which door it left by.</p><div className="ds-row"><button className="ri-btn ri-btn-blue">Find a dock</button><button className="ri-btn">Read the story</button></div></div>
    <div className="ds-tpl-hero-art">{/* draw this screen in the hand */}</div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Door one · kept</h4><p>Most bikes need twenty minutes and one part. They go straight back out.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Door two · parts</h4><p>A cracked frame still has good wheels. They go to the drawers.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Door three · retired</h4><p>Clean steel to the recycler, weighed and counted.</p></div></div>
</div>
```

## Do and don't

- Three inks and a key; let them multiply where they cross.
- Print one word per page three times, slipped by a hair.
- Hang facts on tags and folios in mono caps.
- Open chapters full-bleed in one ink with the number enormous.

Don't:

- No gradients, no blur, no rounded corners.
- No yellow text and no yellow lines.
- No fourth ink; status colours live in callouts and tags only.
- No more than one ticker and one overprint word per page.

## What has no slot

The overprint (three plates with a slip), multiply blending, the halftone screen, the manila tag stock, the hard shadow and the turn have no contract slot. They are carried as --ds-* properties and the ri-* classes above; kit components take paper, key, blue and yellow but stay square and flat.
