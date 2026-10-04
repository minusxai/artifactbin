---
name: system-phosphor
kind: data
description: >-
  Phosphor, a design system for artifactbin: Green text. Black glass. No lies. Technical; for dev tools, ci, logs, status pages. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Phosphor.** A terminal that tells the truth. Phosphor is the green screen with the lies removed: one monospace face at every size, light that glows instead of shadows that fall, a prompt instead of a hero. It belongs to tools whose readers already trust the terminal and want the web page to behave like it.

- **Use it for:** CI dashboards, log viewers, status pages, developer docs, release notes, anything a person reads while something is running.
- **Avoid it when:** Marketing, long prose, consumer subjects, or any page where more than two colours need to mean something at once.
- **Fit:** Dashboard best · Deck avoid · Editorial avoid · Scrolly avoid · Plan best · App best · Landing good.
- **Fonts:** IBM Plex Mono, every weight the roles use, served by the runtime. Opens night first.
- **Published specimen:** `/a/ODaz7L` on the public artifactbin renders everything below in both modes. From: Ten Systems gallery, extended with a paper mode.

## Bind it

1. Fence: `theme: phosphor`, and the page type's `template` (none for app and landing). That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Phosphor (ODaz7L) · base=<theme> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-green: #0a7f5a; } .dark { --ds-green: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(44px, 7vw, 88px)/.95 · 700 | One per page. Covers and the headline state of a system. |
| `t-display-l` | display · clamp(30px, 4vw, 48px)/1 · 700 | Section openers and page titles. |
| `t-title` | display · 20px/26px · 700 | Panel titles, job names. |
| `t-body` | sans · 15px/24px · 400 | Default reading text. Everything is mono; the rhythm comes from leading. |
| `t-body-s` | sans · 13px/20px · 400 | Timestamps, captions, helper text. |
| `t-label` | sans · 12px/16px · 500 | Eyebrows and column heads. Caps through CSS. |
| `t-numeral` | mono · 40px/44px · 500 | KPI figures. Tabular. |
| `t-log` | mono · 13px/20px · 400 | Log lines and commands. Prefixed by a prompt glyph, never a box. |

## Colour

Night is the native mode: the glass is nearly black, green is both brand and pass, and amber marks the one thing happening now. Paper is a printout of the same screen, with the greens darkened to read. Chart series stay away from the three state colours where they can.

| Token | Use |
|---|---|
| `--ds-glass` | Page ground. Black glass in Night; a printout in Paper. |
| `--ds-glass-raised` | Panels, fields, menus. |
| `--ds-glass-sunk` | Log wells, code, inactive tracks. |
| `--ds-line` | Hairline rules between log lines and table rows. |
| `--ds-edge` | The 1px outline on controls and panels. In Night it is the phosphor itself. |
| `--ds-ink` | Primary text. Pale green-white in Night so the glow has somewhere to go. |
| `--ds-ink-muted` | Secondary text, timestamps, dimmed log lines. |
| `--ds-green` | The brand and the pass state. Primary actions, the prompt, the cursor. |
| `--ds-on-green` | Text on green fills. |
| `--ds-green-ink` | Green as text: links, the active line. |
| `--ds-green-soft` | Ground for pass rows and selected lines. |
| `--ds-amber` | The attention colour: focus ring, warnings, the one thing running now. |
| `--ds-on-amber` | Text on amber fills. |
| `--ds-amber-soft` | Ground for warning rows. |
| `--ds-positive` | Pass. Shares green: in Phosphor, green means it worked. |
| `--ds-caution` | Flaky, pending, retrying. |
| `--ds-negative` | Fail. The only red on the screen. |
| `--ds-negative-soft` | Ground for failed rows and error callouts. |
| `--ds-cyan` | Second chart series and the diff-added colour. Never for state. |
| `--ds-violet` | Third chart series. |

Chart series order: green, cyan, amber, violet, ink-muted. Green leads because it is the brand; cyan and violet exist only for charts so series never impersonate a state. Amber is third and should appear only when a series is literally the running one.

## Components

Kit components take Phosphor through the contract and come out square, green and 1px-edged. Authored classes add the prompt glyph, the glow and the state rows.

- **Buttons.** Kit buttons on the left. Authored p-btn on the right: 1px edge, mono lowercase, the primary glows green on hover, the amber variant is reserved for the running job.
- **Tags.** State tags are a filled or hollow dot plus the word. Three states only; queued is hollow.
- **Fields.** Fields are glass-sunk wells with a 1px edge; focus is amber. The switch is a square track with a square thumb.
- **Stat.** A Stat is a label, a mono numeral, a delta. The live Stat glows amber; everything else is flat glass.
- **Callouts.** Callouts are log lines with a glyph: ✓ ! ✗. The ground tints toward the state; the text stays ink.
- **Chart.** Charts are green first, cyan second. Gridlines are the line token; no area fills in Night because glow and fill fight.
- **Table.** Tables are the log: 1px rules, mono figures, state dots in the first column. The header is the label role.
- **Card.** A panel is a titled well. The live panel glows; a finished panel is flat. Logs inside are the log role with a prompt glyph per command.

```jsx
<Button>Run pipeline</Button><Button variant="secondary">Retry</Button><Button variant="outline">View logs</Button><Button variant="ghost">Cancel</Button><button className="p-btn p-btn-primary">$ run</button><button className="p-btn">view logs</button><button className="p-btn p-btn-amber">running…</button>
<Badge>pass</Badge><Badge variant="secondary">cached</Badge><Badge variant="outline">skipped</Badge><Badge variant="destructive">fail</Badge><span className="p-tag p-pass">● pass</span><span className="p-tag p-run">● running</span><span className="p-tag p-fail">● fail</span><span className="p-tag">○ queued</span>
<div className="p-stat"><span className="t-label">Pass rate · 7d</span><span className="t-numeral"><Number data="$totals" col="pass_rate" suffix="%" format=".1f" /></span><span className="p-delta p-up">▲ 0.4 pts</span></div><div className="p-stat p-stat-live"><span className="t-label">Running now</span><span className="t-numeral"><Number data="$totals" col="running" /></span><span className="p-delta">jobs · amber glow</span></div>
<Alert><AlertTitle>No table called orderz</AlertTitle><AlertDescription>Did you mean orders?</AlertDescription></Alert><div className="p-callout p-callout-pass"><strong>✓ 212 tests passed</strong> in 3m 12s on 4 workers.</div><div className="p-callout p-callout-warn"><strong>! flaky:</strong> auth/session.test.ts retried once and passed.</div><div className="p-callout p-callout-fail"><strong>✗ 3 failed</strong> · reader/hydration.test.ts:88 expected 2, got 3.</div>
<div className="p-panel p-panel-live"><div className="p-panel-head"><span className="t-label">deploy-prod · #4812</span><span className="p-tag p-run">● running</span></div><pre className="p-log"><code>$ npm run build
✓ islands built (14.2s)
✓ 12 gate shards queued
› gate-hydration · worker-3 · 00:42</code></pre><button className="p-btn">view full log</button></div>
```

Classes the runtime provides: `p-tint`, `p-dot`, `p-green`, `p-amber`, `p-sunk`, `p-rim`, `p-cursor`, `p-glow`, `p-glow-a`, `p-amber-fill`, `p-muted-fill`, `p-on-green`, `p-blink`, `p-muted`, `p-amber-ink`, `p-btn`, `p-btn-primary`, `p-btn-amber`, `p-tag`, `p-pass`, `p-run`, `p-fail`, `p-stat`, `p-stat-live`, `t-numeral`, `p-delta`, `p-up`, `p-callout`, `p-callout-pass`, `p-callout-warn`, `p-callout-fail`, `p-panel`, `t-label`, `p-panel-live`, `p-panel-head`, `p-log`, `p-prompt-line`, `p-prompt`, `h-fill`, `h-fill2`, `h-glow`, `h-ink`, `h-num`, `h-text`.

## The hand

One-pixel green lines that glow. Phosphor draws like a vector display: 1.5px lines in phosphor green with a soft glow behind them, no fills except the dim glass of a panel and the one amber block. Lines are the drawing; light is the depth. In Paper mode the glow is off and the lines read as a printout.

| Rule | How |
|---|---|
| Stroke | 1.5px green, square caps. Every edge is a lit line; nothing is a solid shape. |
| Fill | Dim glass for grounds; green for the one lit region; amber for the one thing running. |
| Glow | A wide 9px copy of every line at 30% behind it. Off in Paper. |
| Texture | The 16px dot grid behind drawings, at 40%. |
| Figures | Mono caps at 11px; the mono numeral for the one number. |
| Motion | Lines may blink once at 1s when they first appear; nothing else moves. |

Drawing mode `glow`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hero-bg`, `--ds-slide-bg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Phosphor draws with the dot grid, the prompt glyph and horizontal bars of green light. The data lives in the bars: a pipeline is a row of segments, a pass rate is a bar that fills.

- **The pipeline strip.** Each stage is a segment: filled green for pass, amber for running (glowing), hollow for queued, red for fail. Durations sit under each segment in the log role.
- **The prompt line.** Commands open with a green prompt glyph and a blinking block cursor. Use it for the page opener: the command that produced what the reader is looking at.
- **The fill bar.** A pass rate or a budget as a bar of light inside a 1px track. Label the value at the end of the fill, in the numeral role, never above it.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · best

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours.

```jsx
<div className="ds-tpl ds-tpl-dash">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">phosphor ci</span><span className="t-label ds-tpl-crumb">main · last 24h</span><div className="ds-tpl-bar-end"><Segmented label="Window" value="$pick" options={["Runs", "Jobs", "Logs"]} /></div></div>
  <div className="ds-tpl-kpis"><div className="ds-tpl-kpi"><span className="t-label">Tests passed</span><span className="t-numeral"><Number data="$totals" col="tests" /></span><span className="ds-tpl-delta">✓ all green</span></div><div className="ds-tpl-kpi"><span className="t-label">Gates running</span><span className="t-numeral"><Number data="$totals" col="running" /></span><span className="ds-tpl-delta">of 12 shards · amber</span></div><div className="ds-tpl-kpi"><span className="t-label">Pass rate · 7d</span><span className="t-numeral"><Number data="$totals" col="pass_rate" suffix="%" format=".1f" /></span><span className="ds-tpl-delta">▲ 0.4 pts</span></div></div>
  <div className="ds-tpl-dash-grid">
    <div className="ds-tpl-tile"><span className="t-label">Stage durations · last 3 runs</span><Question data="$series" height="240px" viz={{"kind": "vega-lite", "spec": {"mark": "bar", "encoding": {"x": {"field": "run", "type": "ordinal", "title": "Run"}, "y": {"field": "seconds", "type": "quantitative", "title": "Seconds"}, "color": {"field": "stage", "type": "nominal", "title": "Stage"}, "xOffset": {"field": "stage"}}}}} /></div>
    <div className="ds-tpl-tile"><span className="t-label">jobs</span><DataTable data="$table" rowKey="job" height="240px" columns={[{"col": "state", "title": "State"}, {"col": "job", "title": "Job"}, {"col": "worker", "title": "Worker"}, {"col": "seconds", "title": "Seconds", "align": "right", "bar": true}]} /></div>
  </div>
</div>
```

### Deck · avoid

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Expect custom CSS: Marketing, long prose, consumer subjects, or any page where more than two colours need to mean something at once.

### Editorial · avoid

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure. Expect custom CSS: Marketing, long prose, consumer subjects, or any page where more than two colours need to mean something at once.

### Scrolly · avoid

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Expect custom CSS: Marketing, long prose, consumer subjects, or any page where more than two colours need to mean something at once.

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

### App · best

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.

```jsx
<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">phosphor ci</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="grep the log" value="$pick" /><button className="p-btn p-btn-primary">$ run</button></div></div>
  <div className="ds-tpl-rows"><div className="ds-tpl-row"><span className="ds-tpl-row-name">gate-hydration</span><span className="ds-tpl-row-meta">worker-3 · 00:42</span><span className="ds-tpl-tag is-warn">running</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">test-api</span><span className="ds-tpl-row-meta">worker-2 · 3m 10s</span><span className="ds-tpl-tag is-ok">pass</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">gate-export</span><span className="ds-tpl-row-meta">worker-3 · failed at step 3</span><span className="ds-tpl-tag is-bad">fail</span></div><div className="ds-tpl-row"><span className="ds-tpl-row-name">deploy</span><span className="ds-tpl-row-meta">queued behind gates</span><span className="ds-tpl-tag is-idle">queued</span></div></div>
  <div className="ds-tpl-form"><Select label="Branch" value="$pick" options={["Runs", "Jobs", "Logs"]} /><Switch label="Follow output" checked="$flag" /><button className="p-btn">save</button></div>
</div>
```

### Landing · good

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Classes the specimen uses: `ds-tpl-landing`, `ds-tpl-hero`, `ds-tpl-hero-words`, `t-label`, `ds-tpl-kicker`, `t-display-xl`, `ds-tpl-hero-h`, `ds-tpl-hero-sub`, `ds-row`, `p-btn`, `p-btn-primary`, `ds-tpl-hero-art`, `h-ground`, `h-muted`, `h-fill`, `h-fill2`, `h-glow`, `h-ink`, `h-num`, `h-text`, `ds-tpl-feats`, `ds-tpl-feat`, `t-title`.

## Do and don't

- One typeface. Size, weight and leading make the hierarchy.
- Green for pass, amber for now, red for fail. Nothing else carries state.
- Open on the command and its result.
- Glow the one live thing; leave everything else flat.

Don't:

- No rounded corners, no drop shadows, no gradients.
- No second status colour; blue and violet exist only in charts.
- No caps outside the label role.
- No figure without a timestamp.

## What has no slot

The glow, the prompt glyph, the dot grid and the three-state tag rows have no contract slot; they are the --ds-glow properties and p-* classes above. The kit switch stays rounded, which is the one place Phosphor loses its square.
