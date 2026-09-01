'use client';

/**
 * THE LANDING — one column, everything that matters in the first screen.
 *
 * The order is what a stranger actually needs: what this is (the line), how to
 * start (the picker, which IS the product's front door), what you would use it
 * for (the wheel, with the real document under each answer), and why this
 * rather than a gist. Setup leads the proof deliberately — the picker is the
 * only thing on the page that does anything, and burying it under a gallery
 * spends the visit on browsing.
 *
 * Single column, so the reading order and the visual order are the same one.
 * An earlier version split the hero to buy vertical room; compressing the
 * headline and dropping the standalone integration line bought the same room
 * without asking the eye to choose a side.
 */
import GetStarted from '@/components/GetStarted';
import LandingFooter from '@/components/LandingFooter';
import UseCarousel from '@/components/UseCarousel';
import FeatureSpecimens from '@/components/FeatureSpecimens';
import { type ArtVariant } from '@/lib/landing-content';

const COLUMN = 'mx-auto max-w-3xl px-4 sm:px-6';

/**
 * WHICH RENDERING OF THE ILLUSTRATIONS THE FEATURES BAND CARRIES.
 *
 * Both exist and both are still on disk — every claim's art is derived in a
 * felt and a watercolour version at two widths — so this is a one-word switch
 * back, not a decision that threw anything away. The band was briefly rendered
 * TWICE, once per rendering under an `option` divider, so the two could be
 * compared in place; that scaffolding is gone now that the page is being shown
 * to people for feedback, because a comparison rig reads as an unfinished page
 * to anyone who was not in the conversation.
 */
const ART: ArtVariant = 'water';

export default function Landing() {
  return (
    <main className="pb-20">
      <section aria-label="What artifactbin is" className={`${COLUMN} pt-6 sm:pt-7`}>
        {/* SERIF STATES, MONO LABELS, SANS EXPLAINS — the rule the landing's
          * typography now follows (see --font-serif in globals.css). This is the
          * page's largest claim in its own words, so it is set in the display
          * face; the Garamond takes a much larger size than the mono did at the
          * same measure, because its lowercase is small and its strokes are
          * fine — set at the old size it read as a caption.
          *
          * THE CAP IS THE REAL SIZE, AND THE vw TERM ONLY HAS TO REACH IT.
          * COLUMN stops growing at max-w-3xl (a 720px measure once the viewport
          * passes ~816px), so a headline that keeps scaling with the VIEWPORT
          * past that point is sized against something the text is not measured
          * in: at 4.4vw the old 3.1rem cap did not land until 1127px, leaving
          * every width in between under-filling a column already at its full
          * width — three lines at 81/84/51% of the measure. 6.6vw lands the cap
          * just after the column freezes, and 3.75rem is the size that fills it
          * (98/86/78%, measured). Bigger is NOT better here: 64px spills to four
          * lines and drops back to 67/63/83/66%. `text-balance` is a no-op at
          * this size — the natural wrap is already even — and is kept for the
          * narrow widths where it still earns its place. */}
        <h1 className="text-center font-serif text-[clamp(1.9rem,4.4vw,3.2rem)] leading-[1.15] font-medium tracking-[-0.01em] text-balance text-fg">
          Your agents <span className="text-accent">publish</span> interactive HTML documents
          you can <span className="text-accent">edit</span>,{' '}
          <span className="text-accent">annotate</span> and{' '}
          <span className="text-accent">share</span>.
        </h1>
      </section>

      <section className={`${COLUMN} mt-6`}>
        <GetStarted reveal />
      </section>

      <section className={`${COLUMN} mt-14 sm:mt-16`}>
        <UseCarousel />
      </section>

      {/* Full-bleed on purpose: the band paints itself in the paper its own art
        * was drawn on, so it must reach the viewport edges. It owns its own
        * reading column — never wrap it in COLUMN. */}
      <div className="mt-14 sm:mt-16">
        <FeatureSpecimens variant={ART} />
      </div>

      <LandingFooter column={COLUMN} />
    </main>
  );
}
