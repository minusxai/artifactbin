---
name: templates-scrolly
description: >-
  The scrolly genre in full: beats, layout grammar, a copyable skeleton, Do/Don't. Read only for a long or intricate scrolly — the brief's sketch is enough for a short, plain one.
read_first_max: 6144
order: 3
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats: [[ template.beats | join(' → ') ]]

Voice, second person: "you'd expect X — that's not what happened". The humor is in the
telling, never at the data's expense.

THE CONCEIT (the biggest lever): invent the fiction the data lives inside and
commit EVERY element to it — the console's name, chapter labels in its voice, figure
numbers, status chips, timestamps. One conceit, total commitment.

Type register: the utility face IS the conceit's voice — `font-mono text-xs uppercase
tracking-widest` on ALL labels; display shouts the two-tone claims, condensed and huge;
body stays in short bursts.

Skeleton (one pass of the beats; the costume here is a traffic monitor — wear your own):

  <Helmet><Query name="daily">{`select day, transits from ref_<datasetId> order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container bg-background px-6 text-foreground @2xl:px-12">
    <div className="-mx-6 flex justify-between border-b-2 border-foreground bg-foreground px-6 py-3 font-mono text-xs uppercase tracking-widest text-background @2xl:-mx-12 @2xl:px-12">
      <span>Strait Watch · Traffic Monitor</span><span>● Closed · as of 17 Jun 00:00Z</span>
    </div>
    <section className="mx-auto max-w-6xl py-16">
      <h1 className="animate-fade-up text-6xl font-bold uppercase tracking-tight @2xl:text-8xl">The strait went <span className="text-primary">dark.</span></h1>
      <p className="animate-fade-up [animation-delay:200ms] mt-6 max-w-prose text-lg text-muted-foreground">Setup in one sentence, second person — you'd expect a dip; it stopped.</p>
      <p className="mt-10 border-2 border-dashed border-foreground/60 p-6 font-mono text-xs uppercase tracking-widest shadow-[8px_8px_0_0_var(--primary)]">Peak day · <Number data="$daily" col="transits" agg="max" format=",.0f" /> transits</p>
    </section>
    <div className="-mx-6 overflow-hidden border-y-2 border-foreground bg-primary py-2 text-primary-foreground @2xl:-mx-12">
      <div className="flex w-max animate-marquee [animation-duration:20s] font-mono text-xs uppercase tracking-widest">
        <span className="px-4">··· Cargo -97% ··· Daily 95→5 ···</span><span className="px-4">··· Cargo -97% ··· Daily 95→5 ···</span>
      </div>
    </div>
    <div className="-mx-6 bg-foreground py-10 text-center font-mono text-xs uppercase tracking-widest text-background @2xl:-mx-12">↓ Sitrep 02 · The chokepoint</div>
    <section className="mx-auto max-w-6xl py-16">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="reveal-left inline-block -rotate-2 border-2 border-foreground px-3 py-1 font-mono text-xs uppercase tracking-widest">Sitrep 02</span>
        <em className="text-muted-foreground">the italic aside</em>
      </div>
      <h2 className="reveal-up mt-6 text-4xl font-bold uppercase tracking-tight @2xl:text-6xl">Nobody <span className="text-primary">turned around.</span></h2>
      <div className="mt-6 grid gap-8 @3xl:grid-cols-2">
        <p className="leading-relaxed">Three sentences, no more: the prose sets up the evidence.</p>
        <p className="leading-relaxed text-muted-foreground">The second column carries the counter-intuition, not a summary.</p>
      </div>
      <div className="reveal-up mt-10 border-2 border-foreground p-4 shadow-[8px_8px_0_0_var(--primary)]">
        <Question data="$daily" viz={{"kind":"vega-lite","spec":{}}} height="380px" />
        <p className="mt-3 border-t border-dashed border-foreground/60 pt-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">Fig.02 · What it shows <span className="text-primary">— Feb onward: the gap</span></p>
      </div>
    </section>
    <section className="-mx-6 bg-foreground px-6 py-16 text-background @2xl:-mx-12 @2xl:px-12">
      <h2 className="mx-auto max-w-6xl text-4xl font-bold uppercase tracking-tight @2xl:text-6xl">The twist breaks the pattern: <span className="text-primary">one series lit.</span></h2>
    </section>
    <section className="mx-auto max-w-6xl py-16">
      <h2 className="text-5xl font-bold uppercase tracking-tight @2xl:text-7xl">The payoff is one sentence with <span className="text-primary">its number.</span></h2>
      <p className="mt-8 border-t-2 border-foreground pt-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">End of transmission · sources, window, exclusions</p>
    </section>
  </div>

## Rules

THE FUN KIT (compose 4-6 per story; pace them, never all on one screen):
- Console topbar: it scrolls away; fixed and sticky are banned.
- Two-tone headline: THE one word of the claim in the accent — hero on
  `animate-fade-up`, chapter headlines on `reveal-up`.
- Ticker band: a full-bleed accent strip of repeating key stats that SCROLLS — the
  skeleton's two identical spans are what makes the -50% marquee loop seamless, and
  `[animation-duration:20s]` tunes the speed. A section seam, once or twice.
- Scroll reveals: `reveal-up` on the chart slab, staggered stat cards
  (`[transition-delay:120ms]`, `240ms`) — one per chapter. Captures and reduced-motion
  viewers see the page finished.
- Drawn motif: a small inline `<svg>` in the conceit's voice, `currentColor` strokes,
  local `url(#id)` refs only. Motion beyond the kit: class-scoped,
  reduced-motion-guarded `@keyframes` in the document's `<style>{`...`}</style>` block,
  never fighting a utility (utilities are !important).
- Page-break band: the skeleton's inverted strip plus a GIANT ghost chapter numeral
  (15% opacity, accent) bleeding off one edge.
- Stamped section label: the chapter kicker and its italic aside are ONE flex row,
  full-width ABOVE the headline — never in their own grid column.
- Hard-shadow chart slab: an OFFSET SOLID shadow, no blur, alternating the accent and
  foreground tokens per chapter; each closes on the dashed-top spec strip — `FIG.02 ·
  WHAT IT SHOWS` left, accent annotation right.
- Dashed stat cards: `border-dashed` cards, a giant accent single-value embed with arrow
  notation for change ("3,253 → 129", a suffix in the embed's columnFormats, still live). Stagger a row.
- Chip row of key facts under the hero; a blueprint-grid texture (`bg-[size:48px_48px]`
  over a `linear-gradient`) on quiet sections; an accent drop cap per chapter.

STRUCTURE: three to five chapters instead of one, dashed stat cards beside
the chart slab (`@3xl:grid-cols-[3fr_2fr]`). The TWIST chapter breaks the pattern —
inverted ground, or the evolving chart: re-embed the SAME question
across steps with progressive `viz` overrides (gray, then one series accented, then the
domain zoomed) — the platform's scrolly scene, no sticky needed.

Only the BANDS run full-bleed (ticker, page-break, inverted twist); chapter content stays
in the centered `max-w-6xl` shell. Every chapter opens the same way — band, label row,
headline; the twist is the one sanctioned break.

BALANCE: split a chapter only when both columns carry comparable height — prose one side,
evidence the other. If one cell would hold just a label or a lone stat, stack it above.

Do
- Alternate dark/light grounds between chapters.
- Direct-label the thing being followed; captions do jokes AND work.
Don't
- Fake sticky scenes; walls of prose; two conceits; a payoff without its number.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
