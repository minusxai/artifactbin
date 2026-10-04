---
name: system-arcade
kind: data
description: >-
  Arcade, a design system for artifactbin: Insert coin. Press start. Have fun. Fun; for games, launches, leaderboards, playful dashboards, teaching. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Arcade.** Everything is a game, so make it feel like one. Arcade is the cabinet with the lights on: a near-white ground with a faint checker, pixel-black ink, and the NES primaries (red, blue, yellow, with magenta and cyan for the power-ups). Status is an HP bar that goes green, yellow, red in blocks. Lives are hearts, points are coins, hints blink, wins get a ribbon. Night is the CRT: black glass, scanlines, the colours lifted to neon.

- **Use it for:** Game and launch pages, leaderboards and trackers, hackathons, playful dashboards, teaching material for kids and anyone else, anything that gets better with a score.
- **Avoid it when:** Serious, institutional or long-reading subjects; dense data; anything where a pixel heart would read as a joke at the reader's expense.
- **Fit:** Dashboard good · Deck good · Editorial avoid · Scrolly good · Plan avoid · App good · Landing best.
- **Fonts:** Press Start 2P · Pixelify Sans · VT323, every weight the roles use, served by the runtime. Opens day first.
- **Published specimen:** `/a/IBtSRG` on the public artifactbin renders everything below in both modes. From: Gallery, reworked: bright cabinet palette, CRT night.

## Bind it

1. Fence: `theme: arcade`, and the page type's `template` (none for app and landing). That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Arcade (IBtSRG) · base=<theme> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-red: #0a7f5a; } .dark { --ds-red: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(22px, 3.4vw, 44px)/1.4 · 400 | One per page, three words at most. Press Start 2P is huge per point; 44px is the ceiling. |
| `t-display-l` | display · clamp(15px, 2vw, 26px)/1.5 · 400 | Section openers. |
| `t-title` | sans · 26px/30px · 700 | Card, panel and dialogue titles. Pixelify Sans bold. |
| `t-body` | sans · 18px/26px · 400 | Reading and UI text. Pixelify Sans at 18px reads cleanly and still looks like a game. |
| `t-body-s` | sans · 15px/20px · 400 | Captions, helper text, the small print. |
| `t-label` | display · 10px/16px · 400 | Eyebrows, HUD labels, column heads, tags. Press Start 2P at 10px. |
| `t-numeral` | mono · 56px/52px · 400 | Scores and counts. VT323, zero-padded, tabular, big. |
| `t-combo` | sans · 48px/48px · 700 | The multiplier and the one celebratory word. Pixelify bold italic in red or yellow. |
| `t-mono` | mono · 22px/26px · 400 | HUD rows, logs, dialogue. VT323 at 22px. |

## Colour

Day is the cabinet: a near-white ground with a faint checker, ink pixels, red primary, blue for player two, yellow coins, magenta and cyan power-ups. Night is the CRT: black glass with 4px scanlines and every colour lifted to neon. Green, yellow and red carry status in blocks; nothing else does.

| Token | Use |
|---|---|
| `--ds-ground` | Page ground: near-white cabinet by day; the CRT black by night (with scanlines). |
| `--ds-raised` | Panels, cards, the dialogue box. |
| `--ds-sunk` | Wells, the checker squares, empty HP blocks. |
| `--ds-line` | Hairline rules; the checker contrast. |
| `--ds-ink` | Pixel ink: text, sprites, every 4px frame. |
| `--ds-ink-muted` | Secondary text, the dim high score. |
| `--ds-red` | The brand: cabinet red. Primary actions, hearts, the player sprite. |
| `--ds-on-red` | Text on red fills. |
| `--ds-blue` | Player two: the second drawing fill, the first chart series, links. |
| `--ds-on-blue` | Text on blue fills. |
| `--ds-blue-soft` | Ground for the selected row and the quiet drawing fill. |
| `--ds-yellow` | The coin: points, the highlighted figure, the focus ring, the star. |
| `--ds-on-yellow` | Text on yellow fills. |
| `--ds-magenta` | Bonus items and the fourth chart series. Never a status. |
| `--ds-cyan` | Shields, power-ups and the fifth chart series. Never a status. |
| `--ds-positive` | HP full, pass, level up. The green blocks. Always with a glyph or a word. |
| `--ds-positive-soft` | Ground for pass rows and the level-up ribbon. |
| `--ds-caution` | HP half, low coins, a hint. The yellow blocks. |
| `--ds-caution-soft` | Ground for warnings. |
| `--ds-negative` | HP low, fail, game over. The red blocks. |
| `--ds-negative-soft` | Ground for fail rows. |

Chart series order: blue, red, yellow, magenta, cyan. Blue leads so bars never impersonate the HP bar; red is the comparison; yellow the highlight for the top score. Magenta and cyan come last.

## Components

Kit components take Arcade through the contract: near-white grounds, red primary, ink borders, zero radius, yellow focus. Authored classes add the pixel edge, the stepped shadow, the HP blocks, the coin row, the hearts and the dialogue box.

- **Buttons.** Kit buttons left; authored ar-btn right: Press Start 2P at 12px, the pixel-rounded edge and the stepped shadow. Red is the primary, yellow is the coin, blue is player two.
- **Tags.** Tags are power-up pills: Press Start 2P at 10px in a pixel-rounded edge, each with a glyph. Status tags take the HP colours; magenta and cyan are items.
- **Fields.** Fields are white wells with a 4px ink frame; focus is a yellow outline. Labels are HUD caps.
- **Stat.** A Stat is a HUD panel: label in Press Start, a VT323 numeral, the small print. The coin Stat is yellow; the combo Stat uses the celebratory role.
- **Callouts.** Four callouts: the RPG dialogue box (a speaker, one sentence, a blinking ▼) for anything the page says to the reader, and three HUD messages in the HP colours with a glyph.
- **Chart.** Charts are pixel bars: blue first, red for the comparison, yellow for the top score. Gridlines are the checker colour; nothing is smoothed.
- **Table.** Tables are the high-score board: VT323 figures, Pixelify names, 2px ink rules, the top row in yellow.
- **Card.** A card is a cabinet panel: a ribbon when something was won, a HUD row with hearts, a Pixelify title, the HP bar in blocks, three coins, a button. The active panel casts the stepped shadow.

```jsx
<Button>Press start</Button><Button variant="secondary">Continue</Button><Button variant="outline">Options</Button><Button variant="ghost">Quit</Button><button className="ar-btn ar-btn-primary">Press start</button><button className="ar-btn">Options</button><button className="ar-btn ar-btn-coin">Insert coin</button><button className="ar-btn ar-btn-blue">Player 2</button>
<Badge>Red</Badge><Badge variant="secondary">Selected</Badge><Badge variant="outline">Level 3</Badge><Badge variant="destructive">Game over</Badge><span className="ar-tag">1UP</span><span className="ar-tag ar-tag-coin">★ 004120</span><span className="ar-tag ar-tag-green">▲ HP full</span><span className="ar-tag ar-tag-warn">! 1 coin</span><span className="ar-tag ar-tag-red">▼ HP low</span><span className="ar-tag ar-tag-magenta">◆ bonus</span><span className="ar-tag ar-tag-cyan">◉ shield</span>
<div className="ar-stat"><span className="t-label">Score</span><span className="t-numeral"><Number data="$totals" col="score" format="06d" /></span><span className="ar-small">player 1 · synthetic</span></div><div className="ar-stat ar-stat-coin"><span className="t-label">Coins</span><span className="t-numeral"><Number data="$totals" col="coins" /> / 3</span><span className="ar-small">collect three to open the door</span></div><div className="ar-stat"><span className="t-label">Combo</span><span className="t-combo ar-combo">×3!</span><span className="ar-small">three in a row</span></div>
<Alert><AlertTitle>Game over</AlertTitle><AlertDescription>HP reached zero on level 3. Press start to continue from the last door.</AlertDescription></Alert><div className="ar-dialog"><span className="ar-dialog-who">SHOPKEEPER</span><p>Three coins for the door, friend. The red blocks are where the trouble is.</p><span className="ar-dialog-more ar-blink">▼</span></div><div className="ar-callout ar-callout-green"><strong>▲ Level up!</strong> All three coins collected; the door is open.</div><div className="ar-callout ar-callout-warn"><strong>! One coin left.</strong> The last coin is behind the moving platform.</div><div className="ar-callout ar-callout-red"><strong>▼ HP low.</strong> 20% left. Find a heart.</div>
<div className="ar-panel ar-panel-active"><span className="ar-ribbon">NEW HIGH SCORE</span><div className="ar-hud"><span className="t-label">1UP</span><span className="ar-hud-score">004120</span><span className="ar-hearts"><i></i><i></i><i className="ar-heart-off-i"></i></span><span className="t-label">HI</span><span className="ar-hud-score ar-dim">009999</span></div><h3 className="t-title">Level 3 · The Foundry</h3><p className="ar-card-p">Collect three coins to open the door. The red blocks are where you lose a life.</p><div className="ar-hp"><span className="t-label">HP</span><span className="ar-blocks"><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className="ar-b-on"></i><i className=""></i><i className=""></i><i className=""></i><i className=""></i></span><span className="t-mono ar-hp-n">70%</span></div><div className="ar-row"><span className="ar-coins"><i className="ar-coin-i"></i><i className="ar-coin-i"></i><i className="ar-coin-i ar-coin-off-i"></i></span><button className="ar-btn ar-btn-primary ar-btn-sm">Continue</button></div></div>
```

Classes the runtime provides: `h-num`, `h-text`, `ar-ground`, `ar-chk`, `ar-raised`, `ar-sunk`, `ar-ink`, `ar-red`, `ar-blue`, `ar-yellow`, `ar-green`, `ar-magenta`, `ar-cyan`, `ar-heart-off`, `ar-brick`, `ar-brick-hi`, `ar-px-t`, `ar-on-ink`, `ar-yellow-t`, `ar-red-t`, `ar-vt`, `ar-blink`, `ar-btn`, `ar-btn-primary`, `ar-btn-coin`, `ar-btn-blue`, `ar-btn-sm`, `ar-tag`, `ar-tag-coin`, `ar-tag-green`, `ar-tag-red`, `ar-tag-warn`, `ar-tag-magenta`, `ar-tag-cyan`, `ar-stat`, `ar-stat-coin`, `ar-small`, `ar-combo`, `ar-callout`, `ar-callout-green`, `ar-callout-warn`, `ar-callout-red`, `ar-dialog`, `ar-dialog-who`, `ar-dialog-more`, `ar-dialog-wide`, `ar-panel`, `ar-panel-active`, `ar-card-p`, `t-label`, `ar-ribbon`, `ar-ribbon-green`, `ar-hud`, `ar-hud-score`, `ar-dim`, `ar-hud-end`, `ar-hearts`, `ar-heart-off-i`, `ar-hp`, `ar-blocks`, `ar-b-on`, `ar-hp-n`, `ar-hp-lg`, `ar-coins`, `ar-coin-i`, `ar-coin-off-i`, `ar-row`, `ar-cta`, `ar-press`, `ar-sample`, `ar-hud-top`, `ar-sample-grid`, `ar-sample-bottom`.

## The hand

Eight-pixel cells, four-pixel ink, no curves. Arcade draws like a sprite sheet: every shape snaps to an 8px cell, the ink is a 4px square-capped stroke, fills are flat red and blue, and the SVG is rendered with crispEdges so nothing is smoothed. Any subject can be a sprite; keep it under sixteen cells wide so it reads at any size.

| Rule | How |
|---|---|
| Grid | 8px cells. Coordinates and sizes snap; a shape narrower than one cell does not exist. |
| Stroke | 4px ink, square caps, square joins, crispEdges. |
| Fill | Flat red for the player part, blue for player two, blue-soft for the quiet part, sunk for empty. |
| Shadow | None inside a drawing; the panel around it carries the stepped shadow. |
| Figures | Press Start 2P at 10px for labels; VT323 for the one number. |
| Motion | Sprites move in 4px steps; one may bob with animate-float. |

Drawing mode `pixel`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-fg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`, `--ds-tpl-tile-shadow`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Arcade draws with 8px cells. A share with a threshold is an HP bar in blocks; a small count with a goal is a row of coins; chances left are hearts; and anything the page says is a dialogue box.

- **The HP bar in blocks.** Thirteen blocks in a 4px frame; filled blocks are green above half, yellow above a quarter, red below. The percentage sits beside it in VT323. Use it for any share with a threshold.
- **Coins and hearts.** One pixel coin per unit, yellow when earned and hollow when missing; one heart per chance left. Three coins is the win condition and gets a ribbon.
- **The dialogue box.** A 4px-framed box with a speaker in Press Start, one sentence in VT323 and a blinking ▼. Anything the page says to the reader (a hint, a caveat, a decision) is said this way.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · good

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Classes the specimen uses: `ds-tpl-dash`, `ds-tpl-bar`, `ds-tpl-brand`, `t-label`, `ds-tpl-crumb`, `ds-tpl-bar-end`, `ds-tpl-kpis`, `ds-tpl-kpi`, `t-numeral`, `ds-tpl-delta`, `ds-tpl-dash-grid`, `ds-tpl-tile`.

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Serious, institutional or long-reading subjects; dense data; anything where a pixel heart would read as a joke at the reader's expense.

### Scrolly · good

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Classes the specimen uses: `ds-tpl-scrolly`, `ds-tpl-steps`, `ds-tpl-step`, `t-label`, `t-title`, `ds-tpl-figure`, `ds-tpl-figure-art`, `h-fill`, `h-fill2`, `h-muted`, `h-ink`, `h-num`, `h-text`, `ds-tpl-figure-cap`.

### Plan · avoid

Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows. Expect custom CSS: Serious, institutional or long-reading subjects; dense data; anything where a pixel heart would read as a joke at the reader's expense.

### App · good

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Classes the specimen uses: `ds-tpl-app`, `ds-tpl-bar`, `ds-tpl-brand`, `ds-tpl-bar-end`, `ar-btn`, `ar-btn-primary`, `ds-tpl-rows`, `ds-tpl-row`, `ds-tpl-row-name`, `ds-tpl-row-meta`, `ds-tpl-tag`, `is-ok`, `is-warn`, `is-bad`, `is-idle`, `ds-tpl-form`.

### Landing · best

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.

```jsx
<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">Arcade</p><h3 className="t-display-xl ds-tpl-hero-h">Insert coin. Press start.</h3><p className="ds-tpl-hero-sub">A page that keeps score: coins for progress, hearts for chances, an HP bar for anything with a threshold, and a ribbon when you win.</p><div className="ds-row"><button className="ar-btn ar-btn-primary">Press start</button><button className="ar-btn">How to play</button></div></div>
    <div className="ds-tpl-hero-art"><svg viewBox="0 0 480 240" shapeRendering="crispEdges"><title>phone drawn in the Arcade hand</title><rect className="h-ground" x="176" y="16" width="120" height="208"/><rect className="h-muted" x="192" y="32" width="96" height="160"/><rect className="h-fill" x="200" y="48" width="80" height="40"/><rect className="h-fill2" x="328" y="40" width="72" height="24"/><rect className="h-ink" x="176" y="16" width="120" height="208"/><rect className="h-ink" x="192" y="32" width="96" height="160"/><line className="h-ink" x1="224" y1="24" x2="256" y2="24"/><rect className="h-ink" x="232" y="208" width="16" height="16"/><rect className="h-ink" x="328" y="40" width="72" height="24"/><line className="h-ink" x1="304" y1="64" x2="328" y2="56"/><text className="h-num" x="240" y="150" textAnchor="middle">60</text><text className="h-text" x="240" y="176" textAnchor="middle">OF 100 KEPT</text><text className="h-text" x="364" y="57" textAnchor="middle">UNIT 001</text></svg></div>
  </div>
  <div className="ds-tpl-feats"><div className="ds-tpl-feat"><h4 className="t-title">Keep score</h4><p>Every count is a number you can beat. Zero-padded, in VT323, with a high score beside it.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Three coins</h4><p>Goals are small and visible: a row of coins that fill as you go.</p></div><div className="ds-tpl-feat"><h4 className="t-title">Blocks, not bars</h4><p>Status is green, yellow or red blocks with a glyph. You always know where the trouble is.</p></div></div>
</div>
```

## Do and don't

- Snap everything to 4px; crisp edges only.
- Status in HP blocks: green, yellow, red, with a glyph.
- Yellow for the one highlighted figure; a ribbon for the win.
- Press Start 2P for three-word headlines and the HUD; Pixelify for reading.

Don't:

- No anti-aliased shapes, no rounded corners, no blur.
- No magenta or cyan as status.
- No Press Start 2P paragraphs or anything above 44px.
- No score without a zero-pad.

## What has no slot

The pixel edge and stepped shadow, the scanlines, the checker ground, the HP blocks, the coins, hearts and the dialogue box have no contract slot; they are the --ds-pixel-edge and --ds-pixel-shadow properties and the ar-* classes, plus inline SVG with crispEdges. The ink border rides the border token so kit frames are ink.
