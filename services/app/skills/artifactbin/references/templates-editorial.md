---
name: templates-editorial
description: >-
  The editorial page type: the reader's job, three compositions the thesis chooses between, what the runtime needs for the contents rail and figures, and the rules.
order: 1
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Reports, articles, briefings and long reads use `template: editorial`.
The name describes the reading format; the document can be factual,
analytical or narrative, with the design system supplying its appearance.

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

Voice: a document, not a webpage. Section headlines are CLAIMS in sentence
case ("Retention paid for the price increase"), set quiet; reading only the
headlines delivers the whole argument. The body is measured prose: short
paragraphs, no dangling one-line sections. The design system owns the
kicker, the headline face, the deck and the pull figure (its reference
carries an editorial specimen when it fits); the thesis owns how the
evidence is staged. Pick ONE composition and build that.

## Compositions

- **Illustrated feature.** A persistent subject scene, drawn in the system's
  hand, makes the evidence tangible as the argument develops; figures sit
  inside the scene's vocabulary. For a pilot, a place, an experience.
  Rejected default: a title, six numbered sections and a chart in each.
- **Research dossier.** An argument-led opening, then sources, diagrams and
  comparisons arranged for close reading, with the method where the reader
  can check it. For a case that must survive a skeptic.
- **Pilot report.** The findings up front as bold-lead bullets with their
  numbers, numbered sections that each close on a takeaway, a method footer.
  The restrained one, for a board that reads the summary and skims the rest.

## What the runtime needs

- Three or more `<h2>` sections get a platform-built contents rail beside the
  column on wide screens; keep headings short enough to read in a list.
  Nothing to author.
- Keep each prose column at a readable measure (`max-w-2xl` or the system's
  measure). A centered column is one composition; the system can also use
  margin notes, asymmetric evidence spreads, bands and distinct surfaces.
  Preserve source reading order and stack columns on narrow screens. Figures
  and tables may widen within the document; the platform gives tables their
  own scroll boxes. Keep the page itself free of horizontal overflow.
- Every figure is a `<figure>` with a FIG-numbered `<figcaption>`, numbered
  continuously. Charts are `<Question>` over a `<Query>` in `<Helmet>`,
  evidence 380 to 440px, a lone number 170 to 220px. Diagrams are inline
  `<svg>` in the hand. Images are `<img src="ref:<imageId>" />` or an
  `https://` URL, which is imported at publish and rewritten to `ref:<id>`.

Skeleton of the runtime pieces (publishable as is; the staging is yours):

  <Helmet><Import name="sales" src="ref:abc123" /><Query name="q">{`select month, sum(revenue) revenue from sales.rows group by 1 order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container px-6 py-12 text-foreground @2xl:py-16">
    <article className="mx-auto max-w-2xl">
      <header>
        <p className="t-label">Org · Report No. 12</p>
        <h1 className="t-display-l mt-6">The title states the finding, with its number</h1>
        <p className="t-body-l mt-5">The standfirst says why this matters and to whom, in one sentence.</p>
      </header>
      <section className="mt-14">
        <h2 className="t-title">1. The section headline is a claim, never a topic</h2>
        <p className="mt-5 leading-relaxed">Two to four sentences set up the figure: what to look at, and what it will prove.</p>
        <figure className="my-10 @3xl:-mx-24">
          <Question data="$q" viz={{"kind":"vega-lite","spec":{}}} height="400px" />
          <figcaption className="mt-3 border-t border-border pt-2 t-body-s">FIG. 01 — what the chart proves, at the data's precision.</figcaption>
        </figure>
        <p className="mt-8 border-t border-border pt-3 leading-relaxed"><strong>Takeaway:</strong> the section's one sentence to keep, with its number.</p>
      </section>
    </article>
  </div>

## Rules

Do
- Sections and figures numbered continuously ("§ 3", "FIG. 04"); a figure
  in nearly every section, with a caption that states the finding.
- A takeaway line closes each section, one sentence with its number, the
  same register every time; the summary up front is the same device aggregated.
- Motion follows the system's register, respects reduced motion and keeps
  prose stable while it is being read.

Don't
- Duplicate contents navigation; decoration that obscures evidence; prose
  too wide to read; a visual order that contradicts source order; topic
  headlines; a section that shows nothing.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
