---
name: system-dossier
kind: data
description: >-
  Dossier, a design system for artifactbin: Say what you know, and how you know it. Evidential; for plans, reports, post-mortems, long features. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**Dossier.** Paper narrates. Ink proves. Dossier is a report of record: a paper page that reads like a feature, cut by full-bleed ink sections that hold the evidence. Every claim wears its class (intel, plan, verified), outcomes land as stamps, what is not yet known is a redaction bar, and one lime stroke marks the word the whole document turns on. It is built for documents that will be argued with.

- **Use it for:** Implementation plans, incident reviews and post-mortems, board reports, pilot evaluations, long features that make a case and show their working.
- **Avoid it when:** Playful or warm subjects, product marketing, anything that must feel light; dashboards scanned in seconds (the condensed caps are for reading, not glancing).
- **Fit:** Dashboard avoid · Deck good · Editorial best · Scrolly good · Plan best · App avoid · Landing good.
- **Fonts:** Archivo · Newsreader · IBM Plex Mono, every weight the roles use, served by the runtime. Opens day first.
- **Published specimen:** `/a/hOMxYy` on the public artifactbin renders everything below in both modes. From: editorial_opus-c + plan_opus-c (paper, ink, violet, lime).

## Bind it

1. Fence: `theme: dossier`, and the page type's `template` (none for app and landing). That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: `<div data-design="tw" className="@container bg-background text-foreground">`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: `{/* design: system=Dossier (hOMxYy) · base=<theme> · thesis=<one sentence> · object=<what the hand draws> · device=<which device carries the data> · overrides=<token list or none> */}`.
4. Override one thing, if the subject needs it, with a Helmet `<style>` that reassigns a single `--ds-*` token under `:root` and again under `.dark`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile `!important`: layout utilities go on role-bearing elements, type utilities never do.

```jsx
<Helmet><style>{`:root { --ds-violet: #0a7f5a; } .dark { --ds-violet: #46d39c; }`}</style></Helmet>
```

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

| Role | Set in | Use |
|---|---|---|
| `t-display-xl` | display · clamp(64px, 12vw, 160px)/.8 · 900 | One per page. The cover word, set condensed and enormous; the second line may be violet. |
| `t-display-l` | display · clamp(40px, 6.5vw, 88px)/.84 · 900 | Section heads, paired with the inverted number block. |
| `t-display-m` | display · 36px/36px · 800 | Page titles, slide titles. |
| `t-title` | display · 20px/24px · 800 | Card titles, row heads, the stamp word. |
| `t-body-l` | sans · 21px/1.4 · 400 | Ledes and decks, in Newsreader. |
| `t-body` | sans · 18px/1.56 · 400 | Reading text. Newsreader at 18 with a 62ch measure. |
| `t-body-ui` | ui · 15px/22px · 400 | Interface text: forms, tables, lists, callouts. Archivo at normal width. |
| `t-body-s` | ui · 13px/18px · 400 | Captions, helper text, dense cells. |
| `t-label` | mono · 11px/16px · 700 | Eyebrows, tags, column heads, footers. Mono caps through CSS. |
| `t-numeral` | display · 48px/48px · 800 | Facts-rail figures and KPIs. Condensed, tabular. |
| `t-mono` | mono · 13px/20px · 400 | Code, SQL, identifiers, ledger figures. |

## Colour

Day first: paper ground, ink type, violet for the brand and the evidence series, lime as the highlighter. Night inverts the page: the ink page becomes the ground and paper panels become the inset. Status colours always carry a word; the class tags carry no colour at all.

| Token | Use |
|---|---|
| `--ds-paper` | Page ground. Paper narrates: the reading surface. |
| `--ds-paper-raised` | Cards, fields, the case-file card. |
| `--ds-paper-sunk` | Wells, code, inactive tracks, table stripes. |
| `--ds-line` | Hairlines inside a section. The 3px rule between sections is ink, not line. |
| `--ds-ink` | Text, rules, redaction bars, the inverted number block. |
| `--ds-ink-soft` | Secondary text, mono eyebrows, captions. |
| `--ds-night` | The evidence ground: a full-bleed ink section inside a paper page (and paper inside the ink page in Night). |
| `--ds-on-night` | Text on night. |
| `--ds-night-muted` | Secondary text on night. |
| `--ds-violet` | The brand. Primary actions, the first chart series, the second line of a headline, stamps. |
| `--ds-on-violet` | Text on violet fills. |
| `--ds-violet-soft` | Ground for selected rows and info callouts; text on it is ink. |
| `--ds-lime` | The highlighter. One stroke under one word per page, the kicker tag, the active segment. Never text. |
| `--ds-on-lime` | Text on lime. |
| `--ds-positive` | Verified. Always with the word. |
| `--ds-positive-soft` | Ground for verified rows and success callouts. |
| `--ds-caution` | Assumed, pending, intel. Always with the word. |
| `--ds-caution-soft` | Ground for assumption callouts. |
| `--ds-negative` | Failed, refuted, blocked. |
| `--ds-negative-soft` | Ground for failure callouts. |

Chart series order: violet, ink, caution, positive, ink-soft. Violet is the measured series, ink the baseline, caution the assumed line, positive the verified one. On night the series lift but keep order. Grid in line, axes in ink, direct labels where they fit.

## Components

Kit components take Dossier through the contract: paper grounds, violet primary, lime accent, 2px radius. The tags, stamps, redaction, section head and case-file card are authored classes (do-*) written against the hand variables, so they port.

- **Buttons.** Kit buttons on the left; authored do-btn on the right: mono caps, 1.5px edge, inverted on hover. One violet action per view; lime is for marking, never for committing.
- **Tags.** The three evidence classes are drawn, not coloured: dashed for intel, filled for plan, double-ruled for verified. Status tags add a soft ground and always a word.
- **Fields.** Fields sit on paper-raised with a 1.5px ink edge and a 3px violet focus outline. Labels are mono caps above the field. The segmented control fills its active segment with lime.
- **Stat.** Facts are a rail: a condensed numeral and a mono caption on a hairline row under a 3px rule. One fact per rail is violet. Figures come from data.
- **Callouts.** A callout opens with its class tag, then one sentence of fact and one of source. Grounds are the soft status tokens; the text stays ink.
- **Chart.** Charts take violet first, ink second. On night they sit in a paper-less panel: axes in on-night, grid in night-muted at 30%.
- **Table.** Ledgers are mono figures on hairline rows, caps heads under a 3px rule, no zebra. A class tag may sit in the first column.
- **Card.** The case-file card: paper-raised, a folder tab, a definition list on hairlines, the violet offset shadow, and a stamp in the corner. One per document.

```jsx
<Button>Approve plan</Button><Button variant="secondary">Mark verified</Button><Button variant="outline">Export file</Button><Button variant="ghost">Cancel</Button><button className="do-btn do-btn-primary">Approve plan</button><button className="do-btn do-btn-lime">Highlight</button><button className="do-btn">Export file</button>
<Badge>Violet</Badge><Badge variant="secondary">Selected</Badge><Badge variant="outline">Draft</Badge><Badge variant="destructive">Refuted</Badge><span className="do-tag do-tag-intel">Intel</span><span className="do-tag do-tag-plan">Plan</span><span className="do-tag do-tag-verified">Verified</span><span className="do-tag do-tag-status is-ok">Verified · 3</span><span className="do-tag do-tag-status is-warn">Assumed</span><span className="do-tag do-tag-status is-bad">Refuted</span>
<div className="do-fact"><span className="t-numeral">14</span><span className="t-label">minutes down</span></div><div className="do-fact do-fact-accent"><span className="t-numeral"><Number data="$totals" col="failed" format=",.0f" /></span><span className="t-label">requests failed</span></div><div className="do-fact"><span className="t-numeral"><Number data="$totals" col="failed_pct" suffix="%" /></span><span className="t-label">of the window</span></div>
<Alert><AlertTitle>Assumed until confirmed</AlertTitle><AlertDescription>The index exists in staging; production is unverified.</AlertDescription></Alert><div className="do-callout do-callout-intel"><span className="do-tag do-tag-intel">Intel</span><p>Edge logs show 610 failures in the first three minutes. Source: the on-call export.</p></div><div className="do-callout do-callout-ok"><span className="do-tag do-tag-status is-ok">Verified</span><p>The partial index is live in production as of 11:42. Checked by two people.</p></div><div className="do-callout do-callout-bad"><span className="do-tag do-tag-status is-bad">Refuted</span><p>The cache was not the cause. Hit rate held at 97% through the window.</p></div>
<div className="do-file"><span className="do-file-tab">Case file</span><dl className="do-file-dl"><dt>Target</dt><dd>Fourteen-minute outage, 30 Sep</dd><dt>Cause</dt><dd>Missing partial index on bookings</dd><dt>Status</dt><dd><span className="do-tag do-tag-verified">Verified</span> 3 of 4 claims</dd><dt>Owner</dt><dd>Platform on-call</dd></dl><span className="do-stamp">Reviewed</span></div>
```

Classes the runtime provides: `do-paper`, `do-ink`, `do-fillink`, `do-night`, `do-lime`, `do-hatch`, `do-violet-rim`, `do-stamp-rim`, `do-stamp-rim-thin`, `do-btn`, `do-btn-primary`, `do-btn-lime`, `do-tag`, `do-tag-intel`, `do-tag-plan`, `do-tag-verified`, `do-tag-lime`, `do-tag-status`, `is-ok`, `is-warn`, `is-bad`, `do-hl`, `do-redact`, `do-stamp`, `do-fact`, `do-fact-accent`, `t-numeral`, `do-callout`, `do-callout-intel`, `do-callout-ok`, `do-callout-bad`, `do-file`, `do-file-tab`, `do-file-dl`, `do-mast`, `do-mast-mid`, `do-kicker`, `do-h1`, `do-l1`, `do-l2`, `do-hero-grid`, `do-dek`, `do-facts`, `do-facts-n`, `do-facts-violet`, `t-label`, `do-night-sec`, `do-shead`, `do-shead-n`, `do-shead-k`, `do-night-grid`, `do-panel`, `do-sample-in`.

## The hand

A traced line and a hatched fill. Dossier draws the way evidence is drawn: a 2px square-capped ink line around everything, 45° hatch in violet where a fill would go, flat sunk paper for the quiet parts, and mono caps for every label. Nothing is painted; everything looks traced from a source. The subject is the artifact's; the hand is this.

| Rule | How |
|---|---|
| Stroke | 2px ink, square caps and joins, on every shape. |
| Fill | Never flat for the subject: 45° hatch in violet at a 6px pitch. Ink hatch for the second series. |
| Quiet parts | Flat sunk paper, no hatch, so the hatched parts read as the data. |
| Figures | Mono caps at 11px; the display face, condensed, for the one number. |
| Ground | Paper-raised behind every drawing; on night, the drawing inverts with the page. |
| Motion | None in the drawing. A stamp beside it may land. |

Drawing mode `hatch`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: `h-ink` strokes, `h-fill`, `h-fill2` and `h-muted` fills, `h-ground`, `h-text` and `h-num` labels, `h-tex` for hatch lines, `h-plate` for the riso offset, `h-shadow`. They read the hand variables (`--ds-hand-bg`, `--ds-hand-cap`, `--ds-hand-fill`, `--ds-hand-fill2`, `--ds-hand-ground`, `--ds-hand-ink`, `--ds-hand-muted`, `--ds-hand-stroke`, `--ds-hand-tex`, `--ds-slide-bg`, `--ds-slide-split-a`, `--ds-slide-split-a-fg`, `--ds-slide-split-b`, `--ds-slide-split-b-fg`, `--ds-slide-title-bg`, `--ds-slide-title-fg`, `--ds-tag-radius`, `--ds-tpl-edge`, `--ds-tpl-radius`, `--ds-tpl-rule`), so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

Dossier draws with a 2px square-capped ink line and 45° hatch where another system would use a flat fill, so figures look traced from evidence rather than painted. Its own devices below.

- **The numbered section head.** An inverted mono number block beside a condensed 900 heading, over a 3px rule. Every section opens this way; the number is the only ornament.
- **Evidence tags and the redaction.** Intel is dashed, plan is filled, verified is double. What is not yet known is a bar in ink, not a question mark; the bar is replaced when the fact arrives.
- **The stamp and the highlighter.** A verdict lands as a rotated mono stamp with a 3px edge and a thin offset outline. The one lime stroke goes under the word the page turns on, skewed like a marker.

Their markup is in the published specimen's source (section 06); copy one, never a palette.

## On each page type

The page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.

### Dashboard · avoid

Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours. Expect custom CSS: Playful or warm subjects, product marketing, anything that must feel light; dashboards scanned in seconds (the condensed caps are for reading, not glancing).

### Deck · good

Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule. Classes the specimen uses: `ds-tpl-slides`, `ds-tpl-stage`, `ds-tpl-stage-title`, `ds-tpl-stage-top`, `ds-tpl-slide-h`, `ds-tpl-slide-sub`, `ds-tpl-stage-foot`, `ds-tpl-stage-stat`, `ds-tpl-slide-big`, `ds-tpl-slide-cap`, `ds-tpl-split`, `ds-tpl-split-a`, `ds-tpl-split-b`.

### Editorial · best

Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.

```jsx
<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">Incident review · Case file 0611</p>
  <h3 className="t-display-l ds-tpl-ed-h">The index that was never written</h3>
  <p className="ds-tpl-deck">Two people pressed Book in the same twenty milliseconds. The database said yes to both. Here is what the logs can prove about the fourteen minutes that followed.</p>
  <p className="t-label ds-tpl-byline">Platform on-call · Rev. 02 · 2 Oct 2026 · verified 3 of 4</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">A</span>t eleven o'clock the booking API began returning two confirmations for one slot. The on-call engineer saw the first alert at 11:03, which the edge logs verify. For the next six minutes the team looked at the cache, which held a 97% hit rate throughout and was not the cause. The partial unique index that should have refused the second write had been written in a migration plan and never in a migration.</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n"><Number data="$totals" col="failed" format=",.0f" /></span><span className="t-label">requests failed · verified</span></div>
  </div>
</div>
```

### Scrolly · good

Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand. Classes the specimen uses: `ds-tpl-scrolly`, `ds-tpl-steps`, `ds-tpl-step`, `t-label`, `t-title`, `ds-tpl-figure`, `ds-tpl-figure-art`, `h-tex`, `h-tex-fill`, `h-tex-fill2`, `h-muted`, `h-ink`, `h-num`, `h-text`, `ds-tpl-figure-cap`.

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

### App · avoid

Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject. Expect custom CSS: Playful or warm subjects, product marketing, anything that must feel light; dashboards scanned in seconds (the condensed caps are for reading, not glancing).

### Landing · good

Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape. Classes the specimen uses: `ds-tpl-landing`, `ds-tpl-hero`, `ds-tpl-hero-words`, `t-label`, `ds-tpl-kicker`, `t-display-xl`, `ds-tpl-hero-h`, `ds-tpl-hero-sub`, `ds-row`, `do-btn`, `do-btn-primary`, `ds-tpl-hero-art`, `h-ground`, `h-muted`, `h-tex`, `h-tex-fill`, `h-tex-fill2`, `h-ink`, `h-num`, `h-text`, `ds-tpl-feats`, `ds-tpl-feat`, `t-title`.

## Do and don't

- Open every section with the numbered head and a 3px rule.
- Tag every claim: intel, plan or verified.
- Put evidence on night and narrative on paper.
- One lime stroke per page, under the word that matters.
- Land outcomes as stamps.

Don't:

- No colour on class tags; the border style is the meaning.
- No rounded cards, no shadows except shadow-file.
- No second accent: violet is the brand, lime is the marker, nothing else.
- No percentages without their base.
- No blur: what is unknown is redacted, not faded.

## What has no slot

The night section (ink inside paper), the class-tag border grammar, the lime highlighter, the redaction bar and the violet file shadow have no contract slot. They are carried as --ds-* properties and the do-* classes; kit components follow paper, ink and violet but not the three-pixel rule.
