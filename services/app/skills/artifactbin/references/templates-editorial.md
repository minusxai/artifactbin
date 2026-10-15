---
name: templates-editorial
description: >-
  The editorial page type: the reader's job, three compositions the thesis chooses between, what the runtime needs for the contents rail and figures, and the rules.
order: 1
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Reports, articles, briefings and long reads use `template: editorial`;
the design system supplies their appearance.

Optional beats: [[ template.beats | join(' · ') ]]

Voice: a document. Quiet, sentence-case headlines state CLAIMS
("Retention paid for the price increase"); together they tell the argument.
Use short, measured paragraphs, without dangling one-line sections. The
design system owns typography and figure styling; the thesis owns how
evidence is staged. Pick ONE composition.

## Contents

- [Explain with a visual](#explain-with-a-visual)
- [Compositions](#compositions)
- [What the runtime needs](#what-the-runtime-needs)
- [Rules](#rules)

## Explain with a visual

Aim for at least one explanatory visual beside its argument, captioned with
what it explains: Mermaid for relationships, HTML/CSS wireframes for
interfaces, animated SVG for mechanisms. Skip decoration; purely textual
pieces need not invent a process. Follow [diagram syntax](markup-svg.md);
animate with CSS or author script, never SMIL, and provide a static
reduced-motion state.

For mechanisms, read [explanatory figures](explainers.md): use `<Isometric>`
for assemblies or custom SVG, with shared signals for sliders and playback.

## Compositions

- **Illustrated feature.** A persistent subject scene in the system's hand
  makes evidence tangible; figures share its vocabulary. For a place or
  experience, avoid a generic title-and-numbered-charts sequence.
- **Research dossier.** Lead with an argument, then sources, diagrams and
  comparisons for close reading, with a checkable method.
- **Pilot report.** Bold-lead findings with numbers, numbered sections ending
  in takeaways, a method footer. For readers who skim after the summary.

## What the runtime needs

- Three or more `<h2>` sections get a platform-built contents rail beside the
  column on wide screens; keep headings short enough to read in a list.
  Nothing to author, but any `<Grid>`, flow mode included, removes the
  contents rail: build columns as a native CSS grid ([templates](templates.md)).
- Keep each prose column at a readable measure (`max-w-2xl` or the system's
  measure). A centered column is one composition; the system can also use
  margin notes, asymmetric evidence spreads, bands and distinct surfaces.
  Preserve source reading order and stack columns on narrow screens. Figures
  and tables may widen within the document. [[ nativeTableAuthoringRule ]]
- Every figure is a `<figure>` with a FIG-numbered `<figcaption>`, numbered
  continuously. Charts are `<Chart>` over a `<Query>` in `<Helmet>`,
  evidence 380 to 440px, a lone number 170 to 220px. Diagrams use `<Mermaid>`
  or inline `<svg>` in the system's hand; wireframes use HTML/CSS. Images are `<img src="ref:<imageId>" />` or an
  `https://` URL, which is imported at publish and rewritten to `ref:<id>`.

Runtime skeleton (choose the staging):

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
          <Chart data="$q" viz={{"kind":"vega-lite","spec":{}}} height="400px" />
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
