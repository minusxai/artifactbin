/**
 * THE QUESTIONS BAND — the four objections the claims above raise but do not
 * answer, set as a plain ruled list.
 *
 * NOT AN ACCORDION, deliberately, and this is the only real decision the
 * component makes. Two of the four answers ARE the page's positioning (why not
 * the artifacts panel in a chat app; why not just write the HTML), and a
 * disclosure widget spends them: it trades the argument for a tidier
 * silhouette, and most readers never open one. Four short answers cost about a
 * screen — which is what this section is for — and they are in the page for
 * anyone reading it as text: a search engine, a screen reader, a full-page
 * screenshot.
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
import { PAGE_COLUMN } from '@/components/ui';
import { QUESTIONS } from '@/lib/landing-content';

export default function LandingFaq({ column = PAGE_COLUMN }: { column?: string }) {
  return (
    <section aria-label="Common questions" className={column}>
      <p className="mb-6 flex items-center gap-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Common questions
        <span aria-hidden className="h-px flex-1 bg-edge" />
      </p>

      {/* The list owns its top rule and every item its bottom one, so the run
        * is evenly ruled and nothing doubles at a seam — the same way the
        * features lattice is drawn. */}
      <dl className="m-0 border-t border-edge">
        {QUESTIONS.map((entry) => (
          <div key={entry.question} className="border-b border-edge py-5">
            <dt className="font-serif text-[1.0625rem] leading-snug font-medium text-fg">
              {entry.question}
            </dt>
            <dd className="mt-2 ml-0 max-w-2xl font-sans text-[14.5px] leading-[1.6] text-muted">
              {entry.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
