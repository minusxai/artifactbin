---
name: templates-scrolly
description: >-
  The scrolly page type: ordinary-flow chapters, three compositions, repeated live figures, entrance motion, and the rules.
order: 3
---
## Read first

[[ template.description ]]

[[ template.personality ]]

Beats, as options rather than a sequence: [[ template.beats | join(' · ') ]]

Voice, second person: "you'd expect X; that's not what happened". The
humor is in the telling, never at the data's expense. The scroll IS the
story: suspense lives between chapters, and the payoff is one sentence
with its number. The design system owns the step cards and the figures,
drawn in its hand (its reference carries a scrolly specimen when it fits);
the thesis owns the conceit. Pick ONE composition and commit every element
to it.

## Compositions

- **Persistent object.** One object from the subject's world transforms or
  comes apart while the reader follows its parts; every chapter shows the
  same object in a new state. For a process, a batch, a mechanism.
  Rejected default: chapters that each show a different chart.
- **Allocation story.** Units move through labelled routes and end in a
  complete ledger; the units and the denominators stay explicit the whole
  way, and the final breakdown is the reveal. For "where did it all go".
- **Broadcast.** The story wears a costume (a console, a field report, a race
  call) and every element plays along: ticker bands (`animate-marquee`, the
  content repeated once), chapter breaks, a twist that breaks the pattern. The theatrical one; pick the register the subject
  can carry, deadpan included.

## Chapter layout and live figures

- Entrance animations are classes: `animate-fade-up` on the hero, `reveal-up` and
  `reveal-left` on chapter elements, staggered with `[transition-delay:120ms]`.
  Captures and reduced-motion viewers see the page finished; nothing is
  hidden from them.
- Re-embed the same named question across chapters with progressive `viz`
  overrides (gray, then one series accented, then the domain zoomed). Each
  chapter renders its own live figure in ordinary document flow. The template
  adds no sticky figure, scroll-triggered chart switching, or reading-progress
  indicator; author each chapter's figure state explicitly.
- Full-bleed bands are unpadded siblings of padded prose sections. Keep the
  outer wrapper unpadded, bands `w-full overflow-hidden`, and prose sections
  `px-6 @2xl:px-12` at a readable measure. Do not widen the document with negative margins:
  clipping a ticker's children does not contain a wider band. Motion beyond the kit is
  class-scoped `@keyframes` in the Helmet style, reduced-motion guarded
  ([markup-motion.md](markup-motion.md)).

Skeleton of the runtime pieces (publishable as is; the conceit is yours):

  <Helmet><Import name="t" src="ref:trf123" /><Query name="daily">{`select day, transits from t.rows order by 1`}</Query></Helmet>
  <div data-design="tw" className="@container text-foreground">
    <section className="mx-auto max-w-6xl px-6 py-16 @2xl:px-12">
      <h1 className="animate-fade-up t-display-xl">The strait went dark.</h1>
      <p className="animate-fade-up [animation-delay:200ms] mt-6 max-w-prose t-body-l">Setup in one sentence, second person.</p>
    </section>
    <section className="mx-auto max-w-6xl px-6 py-16 @2xl:px-12">
      <p className="t-label">Chapter 02</p>
      <h2 className="reveal-up mt-6 t-display-l">Nobody turned around.</h2>
      <div className="reveal-up mt-10 border border-border p-4">
        <Question data="$daily" viz={{"kind":"vega-lite","spec":{}}} height="380px" />
        <p className="mt-3 t-label">Fig. 02 · What it shows</p>
      </div>
    </section>
  </div>

## Rules

Do
- Three to five chapters, each opening the same way; the twist is the one
  sanctioned break.
- Direct-label the thing being followed; captions do jokes AND work.
- Split a chapter only when both columns carry comparable height.

Don't
- Fake sticky scenes; walls of prose; two conceits; a payoff without its
  number.
- A conceit the data cannot carry; chapters that are just a different chart.

Components: [markup.md](markup.md); publish API: [publishing.md](publishing.md).
