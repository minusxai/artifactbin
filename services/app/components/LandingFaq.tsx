/**
 * THE QUESTIONS BAND — the four objections the claims above raise but do not
 * answer, as disclosures that all start shut.
 *
 * NATIVE <details>, NOT A JS ACCORDION, and that is the one decision this
 * component makes. Two of the four answers ARE the page's positioning (why not
 * the artifacts panel in a chat app; why not just write the HTML), and an
 * accordion that mounts an answer only when it is opened spends them: the text
 * is then absent from the page for find-in-page, for a crawler, and for anyone
 * reading it as text rather than clicking through it. A <details> is shut but
 * PRESENT — Chrome even opens one to land a find-in-page hit inside it — so
 * closing the section costs the silhouette and nothing else. It also arrives
 * keyboard-operable and announced, with no state and no client JS.
 *
 * Closed by default is deliberate: four short answers laid open cost about a
 * screen, and the section's job is to be scannable after a long page. The
 * question therefore has to carry the row on its own, which is why it is set
 * larger here than a body line would be.
 *
 * IT COMES BACK OFF THE PAPER. The features band above is full-bleed and
 * painted in the material its illustrations were drawn on; this section has no
 * art, so it returns to the app's own ground and its own reading column, which
 * is also what gives that band a visible end rather than letting the sheet run
 * on into the footer.
 *
 * Typography follows the landing's rule — SERIF STATES, MONO LABELS, SANS
 * EXPLAINS: the eyebrow is a label, each question is a sentence someone is
 * actually asking, and the answers explain.
 */
import { ChevronDown } from 'lucide-react';
import { PAGE_COLUMN } from '@/components/ui';
import { QUESTIONS } from '@/lib/landing-content';

/**
 * `list-none` drops the marker in Firefox and Safari; `flex` is what drops it
 * in Chrome, which paints it from `display: list-item` rather than from the
 * list-style — so both are load-bearing and neither is decoration. The chevron
 * that replaces it is ours, and rotates with the open state.
 */
const SUMMARY =
  'flex cursor-pointer list-none items-start justify-between gap-4 py-4 ' +
  'marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none';

export default function LandingFaq({ column = PAGE_COLUMN }: { column?: string }) {
  return (
    <section aria-label="FAQs" className={column}>
      <p className="mb-6 flex items-center gap-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">
        FAQs
        <span aria-hidden className="h-px flex-1 bg-edge" />
      </p>

      {/* The run owns its top rule and every item its bottom one, so neighbours
        * share a single hairline and nothing doubles at a seam — the same way
        * the features lattice is drawn. */}
      <div className="border-b border-edge">
        {QUESTIONS.map((entry) => (
          <details key={entry.question} className="faq-item group border-b border-edge">
            <summary className={SUMMARY}>
              <span className="font-serif text-[1.1875rem] leading-snug font-medium text-fg transition-colors group-hover:text-accent group-focus-visible:text-accent">
                {entry.question}
              </span>
              <ChevronDown
                aria-hidden
                size={17}
                className="mt-1 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180 group-hover:text-accent"
              />
            </summary>
            <p className="mt-0 mb-5 max-w-2xl pr-8 font-sans text-[14.5px] leading-[1.6] text-muted">
              {entry.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
