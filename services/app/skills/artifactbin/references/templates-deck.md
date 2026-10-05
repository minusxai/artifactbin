---
name: templates-deck
description: >-
  The deck page type: the reader's job, three compositions the thesis chooses between, what the runtime needs from Slide nodes, the slide types, and the rules.
order: 2
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

Voice: a keynote. Every slide headline is a spoken sentence ("Retention
pays for the price increase"), never a label ("Retention"). One idea per
slide. Leave enough space to read the idea at presentation distance.
The design system owns the stage's composition, grounds, type scale, the one big
number and the footer rule (its reference carries a deck specimen when it
fits); the thesis owns which slides exist and in what order. Pick ONE
composition and build that.

## Contents

Compositions · What the runtime needs · Slide types · Rules.

## Compositions

- **Decision programme.** Experience, evidence, options, cost, unknowns and
  a final motion, each slide its own composition, for a board asked to
  approve something. Rejected default: a cover, a contents slide and a run
  of identical chart slides.
- **Analytical briefing.** A small set of legible comparisons builds toward
  an explicit recommendation; the chart slides carry the argument and the
  text slides are few.
- **Narrative keynote.** Acts opened by full-bleed dividers, quiet paper
  slides between, a twist and a close; for a story told to a room rather
  than a decision put to it.

## What the runtime needs

- `<Helmet>` is the FIRST top-level node, before `<SlideDeck>`, never inside it.
- Every slide is a `<Slide title="…">`, with a short spoken title: Slide
  fills the reader's real viewport (`--mx-vh`, platform-provided) as a flex
  column and powers the overview rail and present-mode paging. Give it no
  height of your own; never a raw `<section>` for a slide; no fixed or
  sticky chrome.

Skeleton of the runtime pieces (publishable as is; the slides are yours):

  <Helmet><Import name="sales" src="ref:abc123" /><Query name="q">{`select month, sum(revenue) revenue from sales.rows group by 1 order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container px-6 @2xl:px-12">
    <SlideDeck>
      <Slide title="The one finding" className="border-b border-border py-14">
        <p className="t-label">Company · Quarter</p>
        <h1 className="t-display-l mt-auto max-w-4xl">The title states the one finding</h1>
        <div className="mt-auto pt-10 flex justify-between t-body-s"><span>Author</span><span>Date</span></div>
      </Slide>
      <Slide title="The takeaway, spoken" className="border-b border-border py-14">
        <h2 className="t-display-m max-w-3xl">The headline is the takeaway, spoken aloud</h2>
        <div className="mt-10 max-w-5xl"><Question data="$q" viz={{"kind":"vega-lite","spec":{}}} height="440px" /></div>
        <p className="mt-4 t-body-s max-w-prose">One line under the chart: what to remember when the slide is gone.</p>
      </Slide>
    </SlideDeck>
  </div>

## Slide types

SLIDE TYPES (pick per beat; each stays one idea):
- Act divider: a full-bleed slide in a saturated ground with a giant
  tone-on-tone numeral over the act title, nothing else. The narrative
  keynote opens each act with one; a decision deck may use none.
- Statement: at most three one-line bullets, then air. No paragraphs.
- Columns (2 or 3): equal cells on one gutter, each opening under a rule;
  collapse to one column on phones (`@2xl:grid-cols-3`).
- Quadrants: a 2×2 with hairline cross rules and tiny muted axis labels.
- Chart slide: a claim headline, ONE `<Question>` (430 to 460px, most of the
  width), one takeaway line under it. Gray series, one accented element,
  direct labels. Never two charts on a slide.
- Big number: one enormous accent figure from a styled single-value embed
  plus a two-line muted caption, nothing else; once or twice per deck.
- Table slide: a compact table, uppercase tracked `<th>`, hairline rows,
  `tabular-nums`.
<!--bundle:skip-->
- Quote slide: a display-size quote in the muted ink, a hanging quote mark,
  an attribution line. A breather between dense slides.
- Timeline: a horizontal rail of dated nodes; the current step is the one
  accent square.
<!--/bundle:skip-->
- Cover and close share one grammar; the close restates the lead number and
  the next step.

## Rules

Do
- Speakable headlines; legible display type, few words; deliberate space.
- The same header band and footer meta on every content slide, so the deck
  reads as one object.
- Motion follows the system's register and respects reduced motion; slide
  content remains readable and present-mode paging remains predictable.

Don't
- Two charts competing for attention; paragraphs too long to read at
  presentation distance; backgrounds that compromise contrast.
- Scroll-snap or parallax tricks; cramming a slide to avoid adding one. Add
  the slide.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
