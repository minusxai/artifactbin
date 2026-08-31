---
name: templates-editorial
description: >-
  The editorial genre in full: beats, layout grammar, a copyable skeleton, Do/Don't. Read only for a long or intricate editorial — the brief's sketch is enough for a short, plain one.
read_first_max: 6144
order: 1
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats: [[ template.beats | join(' → ') ]]

Voice: a document, not a webpage. Section headlines are numbered CLAIMS in sentence case
("2. Retention paid for the price increase"), set quiet (`font-semibold tracking-tight`)
— reading only the headlines delivers the whole argument. The body is measured prose:
short paragraphs, no dangling one-line sections.

Skeleton (one pass of the beats):

  <Helmet><Query name="q">{`select month, sum(revenue) revenue from ref_<datasetId> group by 1 order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container bg-background px-6 py-12 text-foreground @2xl:py-16">
    <article className="mx-auto max-w-2xl">
      <header>
        <div className="flex items-baseline justify-between border-b-2 border-foreground pb-2 text-xs uppercase tracking-widest">
          <span className="font-bold">Org · Report No. 12</span>
          <span className="text-muted-foreground">13 Aug 2026</span>
        </div>
        <h1 className="animate-fade-up mt-14 text-4xl @2xl:text-5xl font-semibold tracking-tight leading-tight">The title states the finding, with its number</h1>
        <p className="animate-fade-up [animation-delay:150ms] mt-5 text-lg leading-relaxed text-muted-foreground">The standfirst says why this matters and to whom, in one sentence.</p>
        <p className="animate-fade-up [animation-delay:300ms] mt-8 text-xs uppercase tracking-widest text-muted-foreground">Author · window covered · one line</p>
      </header>
      <section className="mt-14 border-y border-border py-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Summary</p>
        <ul className="mt-4 space-y-2 leading-relaxed">
          <li><strong>Two-word lead:</strong> the finding in one sentence, with its number.</li>
          <li><strong>The caveat:</strong> a report that names its own risk is more credible, not less.</li>
        </ul>
      </section>
      <div className="mt-24 flex items-baseline justify-between border-t border-foreground pt-2 text-[11px] uppercase tracking-widest text-muted-foreground @2xl:mt-32">
        <span>Doc title</span><span>§ 1</span>
      </div>
      <section className="mt-14">
        <h2 className="text-2xl font-semibold tracking-tight">1. The section headline is a claim, never a topic</h2>
        <p className="mt-5 leading-relaxed">Two to four sentences set up the figure: what to look at, and what it will prove.</p>
        <figure className="my-10 @3xl:-mx-24">
          <Question data="$q" viz={{"kind":"vega-lite","spec":{}}} height="400px" />
          <figcaption className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">FIG. 01</span> — what the chart proves, at the data's precision.</figcaption>
        </figure>
        <p className="leading-relaxed text-muted-foreground">The paragraph after the figure says what follows from it — never repeats it.</p>
        <p className="mt-8 border-t border-border pt-3 leading-relaxed"><strong>Takeaway:</strong> the section's one sentence to keep, with its number.</p>
      </section>
      <footer className="mt-24 border-t border-border pt-4 text-xs text-muted-foreground @2xl:mt-32">
        <p className="uppercase tracking-widest">Method & sources</p>
        <p className="mt-2 leading-relaxed">Window, exclusions, and where the data lives — one or two honest lines.</p>
      </footer>
    </article>
  </div>

## Rules

THE OUTLINE: three or more `<h2>` sections get a platform-built table of contents beside
the column on wide screens — keep the headings short enough to read in a list. Nothing
to author.

Type register: display carries the title and the numbered claims, quiet and tight; body
carries the prose at `leading-relaxed`; the utility face carries the apparatus — masthead,
folio lines, § and FIG numbers, table digits (`font-mono` where the theme bundles one, small caps
always tracked).

THE COLUMN (the whole layout): everything lives in ONE centered text column. CHARTS and diagrams are the single sanctioned exception — they may
widen, always symmetrically (`@3xl:-mx-24`, up to `-mx-40` for a wide chart), so they
stay centered on the column's own axis. A TABLE never widens: it sits in the column and
hugs its rows (the platform makes every table its own scroll box), taking `w-full` only
when its rows want the whole measure.

PAGE BREAKS (spend them generously; every new idea gets a fresh page): a numbered section
opens with the SAME folio line every time, verbatim — generous air above
(`mt-24 @2xl:mt-32`), the skeleton's running-header rule (`Doc title` / `§ 02`), then
`mt-14` before the headline. Break hygiene: a figure and its caption never separate, and a
heading never sits at the foot of a page — move the break, not the caption.

FIGURES (aim for one per section). Every figure is a `<figure>` with a FIG-numbered
`<figcaption>`, numbered continuously across the document. Four kinds:
- Chart: `<Question data="$q" viz={{"kind":"vega-lite","spec":{…}}} height="380px" />`
  over a `<Query name="q">{`select … from ref_<datasetId>`}</Query>` declared in
  `<Helmet>` — Vega for every chart; quiet grays, ONE accented series, direct labels over
  legends. Evidence 380-440px; a lone number 170-220px.
- Diagram: an inline `<svg>` drawn in `currentColor` strokes at hairline weights. Local
  `url(#id)` refs only.
- Image: `<img src="ref:<imageId>" />`, or an `https://` URL — a remote image is IMPORTED
  at publish (fetched once, stored) and rewritten to `ref:<id>` for you.
- Table: a plain `<table className="text-sm">` in the column, with its FIG caption, but
  never widened (see THE COLUMN).
Caption grammar (the skeleton's classes): `FIG. 02` — one sentence stating what the
figure proves, at the data's precision.

TAKEAWAYS (in the column, never a rail, never a box):
- Section close: after the last paragraph, one hairline-topped line (`mt-8 border-t
  border-border pt-3`) leading `<strong>Takeaway:</strong>` — one sentence with its
  number, one per section, same register every time.
- The Summary up front is the same device aggregated: the document's 2-4 findings as
  bold-lead bullets, each with its number. State conclusions before arguing them.

Only the title block animates (`animate-fade-up`, staggered once).

Minimal, concretely: the color budget is foreground + muted + hairlines; the accent
appears only INSIDE figures. Tables are compact hairline sets (uppercase tracked `<th>`,
`tabular-nums`, row rules).

Do
- Sections and figures numbered continuously ("§ 3", "FIG. 04"); a figure in nearly every
  section, with a caption that states the finding.
Don't
- Side rails, asymmetric splits, full-bleed bands, KPI strips, boxed takeaway widgets,
  inverted grounds, alternating backgrounds, cards, shadows, rounded boxes — webpage
  furniture on what should be paper.
- Prose wider than the column; a figure widened off the column's axis; motion past the
  title block.
- Topic headlines; a section that shows nothing (no figure, no table, no number).

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
