---
name: templates-deck
description: >-
  The deck genre in full: beats, layout grammar, a copyable skeleton, Do/Don't. Read only for a long or intricate deck — the brief's sketch is enough for a short, plain one.
read_first_max: 6144
order: 2
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats: [[ template.beats | join(' → ') ]]

Voice: a keynote. Every slide headline is a spoken sentence ("Retention pays for the price
increase"), never a label ("Retention"). One idea per slide. A good slide is ~40% empty —
put the air BELOW the content, not around it.

Skeleton (cover → divider → chart slide; extend the pattern per act):

  <Helmet><Query name="q">{`select month, sum(revenue) revenue from ref_<datasetId> group by 1 order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container px-6 @2xl:px-12">
    <SlideDeck>
      <Slide title="Cover" className="border-b border-border py-14">
        <p className="text-xs uppercase tracking-widest font-semibold text-primary">Company · Quarter</p>
        <hr className="mt-3" />
        <h1 className="animate-fade-up mt-auto text-6xl @2xl:text-8xl font-bold tracking-tight max-w-4xl">The title states the one finding</h1>
        <p className="animate-fade-up [animation-delay:200ms] mt-6 text-lg text-muted-foreground max-w-xl">A standfirst no longer than the breath it takes to say it.</p>
        <div className="mt-auto pt-10 flex justify-between text-xs text-muted-foreground"><span>Author</span><span>Date</span></div>
      </Slide>
      <Slide title="Act one" className="justify-center bg-primary text-primary-foreground -mx-6 @2xl:-mx-12 px-6 @2xl:px-12">
        <span className="text-9xl font-bold text-primary-foreground/25">01</span>
        <h2 className="mt-2 text-4xl @2xl:text-5xl font-semibold">Act title, mirrored in the contents</h2>
      </Slide>
      <Slide title="The takeaway, spoken" className="border-b border-border py-14">
        <p className="text-xs uppercase tracking-widest font-semibold text-primary">01 · ACT NAME</p>
        <hr className="mt-3 mb-10" />
        <h2 className="text-3xl @2xl:text-5xl font-semibold max-w-3xl">The headline is the takeaway, spoken aloud</h2>
        <div className="mt-10 max-w-5xl"><Question data="$q" viz={{"kind":"vega-lite","spec":{}}} height="440px" /></div>
        <p className="mt-4 text-sm text-muted-foreground max-w-prose">One line under the chart: what to remember when the slide is gone.</p>
        <div className="mt-auto pt-10 flex justify-between text-xs text-muted-foreground"><span>Deck title — date</span><span className="font-semibold">07</span></div>
      </Slide>
    </SlideDeck>
  </div>

## Rules

Type register (the theme's pairing, spent the keynote way): display does the speaking —
huge spoken headlines, few words; the utility face runs the chrome — kickers, footer
meta, slide numbers, contents rows; body appears only in standfirsts and captions,
never in paragraphs.

`<Helmet>` (title, styles) is the FIRST top-level node, BEFORE `<SlideDeck>` — never inside it.

THE SLIDE (every CONTENT slide — accent dividers are the one exemption, see below;
fixed/sticky are banned — a slide is a tall section):
- `<Slide>` already fills the reader's real viewport (`--mx-vh`, platform-provided, with
  a headless fallback) as a flex column — add the dressing per slide.
  Never vh units (broken in this surface); never a raw `<section>` for a slide — Slide is what
  powers the reader's slide overview and present-mode paging.
- Give EVERY slide a short spoken `title` (it names the slide in the overview rail and the
  present controls).
- HEADER BAND on every content slide: kicker + hairline, then the slide h2 — the
  skeleton's exact classes, the same band on every slide.
- FOOTER META closes every content slide, the same row every time: deck title and date
  left, the slide number right.

ACTS AND COLOR RHYTHM (the interleaving that makes it feel designed):
- EVERY deck ships at least one full-bleed solid-accent divider slide, however short it is.
  A deck of quiet paper slides is the failure this genre exists to prevent — the divider is
  not decoration you drop when slides are scarce, it is the one slide that makes the rest
  read as a deck. Asked for N slides, the divider is one of the N; spend it, don't skip it.
- Group slides into 2-4 numbered acts, and each act OPENS with a divider. Under 6 slides,
  run ONE act: cover → divider → content → content → close. Above that, one divider per act.
- The divider is a `<Slide>` like every other (the skeleton's second), minus the header
  band and footer meta: a giant TONE-ON-TONE act numeral (same hue, darker — or a darker
  literal of the accent) over the act title. Nothing else on the slide.
- Dividers are the ONLY saturated slides; everything between is quiet paper. That alternation
  (paper… paper… ACCENT… paper) is the pulse of the deck — never color a content slide's ground.
- The contents slide lists the acts as numbered rows (accent numerals, hairline row rules,
  `tabular-nums`) whose titles mirror the dividers EXACTLY.

SLIDE TYPES (pick per beat; each stays one idea):
- Act divider (MANDATORY, at least one per deck — the skeleton's middle slide): pick it
  FIRST, before any content slot, then mirror its title in the contents slide.
- Statement: at most 3 one-line bullets with square accent markers
  (`<span className="inline-block size-2 bg-primary mr-3">`), then air. No paragraphs.
- Columns (2 or 3): equal cells on one gutter, and EACH COLUMN OPENS UNDER A RULE
  (`<div className="border-t-2 border-foreground pt-3">` heading + short copy); columns top-align
  and share the line rhythm. Collapse to one column on phones (`@2xl:grid-cols-3`).
- Quadrants: 2x2 grid with hairline cross rules (`divide-x divide-y divide-border`) and tiny
  muted axis labels at the edges ("← less … more →").
- Chart slide: claim headline + ONE `<Question>` (430-460px, ≥ 60% width) + one takeaway line
  under it. Restyle via `viz` override: all series in grays, ONE accent element (the bar/line
  being discussed), direct labels, no legend where possible. Never two charts on a slide.
- Big-number slide: one enormous accent figure — a styled single-value embed
  (`valueColor` = the accent, huge `valueFontSize`) — plus a two-line muted caption. NOTHING else.
  Use once or twice as an act's exclamation point.
- Table slide: a compact table; uppercase tracked `<th>`, hairline row rules, `tabular-nums`.
- Quote slide: display-size quote in `text-muted-foreground` (softer than headlines, not black),
  hanging quote mark, `— attribution` line. A breather between dense slides.
- Timeline: a horizontal rail — uppercase tracked date labels over square nodes over bold
  labels + muted notes, one left edge per milestone; the CURRENT step is the one accent square.
- Cover and Close share one grammar — the skeleton's cover. The close restates the lead
  number and the next step, then contact.

Do
- Ship at least one solid-accent divider slide — a five-slide deck still gets one.
- Speakable headlines; huge type, few words; the air below the content.
- At most a cover entrance (`animate-fade-up`, staggered) — slides page, they don't
  perform.
- One accent element per figure; contents ↔ dividers mirrored to the word.
Don't
- Ship a deck of nothing but paper slides; color a CONTENT slide's ground (the divider is
  the exception, and it is the only one).
- Two charts on a slide; paragraphs (three lines max).
- Scroll-snap/parallax tricks; cramming a slide to avoid adding one — add the slide.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
