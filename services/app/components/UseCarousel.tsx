'use client';

/**
 * "You can use artifact-bin to ___" — a picker wheel, with the real published
 * document that IS that example sitting under it.
 *
 * THE NEIGHBOURS ARE VISIBLE, and that is the whole reason it is a wheel
 * rather than a fade: a phrase that dissolves and is replaced tells you the
 * list is longer than one, but never how much longer or which way it is
 * going. Showing the row above and the row below makes it a LIST being
 * scrolled — you can see what you missed and what is coming, which is what a
 * rolodex is for.
 *
 * The mechanism, so nothing has to be measured: the list is rendered THREE
 * times and the wheel sits on the middle copy, so there is always a real row
 * above and below whatever is centred, including at the ends. Rows are a
 * fixed line tall, so the offset is arithmetic — no layout reads, no jump
 * when the wheel wraps.
 *
 * Pauses while the pointer is on it and RESUMES when it leaves; a click or an
 * arrow just moves it and restarts the clock. It never runs under reduced
 * motion. (Clicking used to stop it for good — the safer default, but it made
 * the carousel feel dead after any interaction.)
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SHOWCASE, showcaseCardUrl, showcaseHref } from '@/lib/showcase';

const INTERVAL = 1500;
const ARROW =
  'absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-accent shadow-sm backdrop-blur-sm transition-colors hover:border-accent hover:bg-accent hover:text-bg';
const N = SHOWCASE.length;
/** The three copies the wheel rides on. */
const TRIPLE = [...SHOWCASE, ...SHOWCASE, ...SHOWCASE];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function UseCarousel() {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  /**
   * WHICH CAPTURES HAVE BEEN ASKED FOR. Every card is a ~160 KB screenshot,
   * and stacking all of them in one grid cell put every one INSIDE the
   * viewport — so `loading="lazy"` deferred nothing and the page pulled the
   * whole set before the reader had seen the second one. Mounting grows by
   * one step ahead of where the reader is: the next capture is already
   * decoded when the wheel reaches it, and the ones past it cost nothing.
   */
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0, 1 % N]));
  const doc = SHOWCASE[active];
  /** The centred row lives in the middle copy. */
  const centre = N + active;

  useEffect(() => {
    // Restarts whenever `active` changes, so a click gets a full interval
    // before the next automatic step rather than the tail of the last one.
    if (held || prefersReducedMotion() || N < 2) return;
    const id = setInterval(() => goTo((active + 1) % N), INTERVAL);
    return () => clearInterval(id);
  }, [held, active]);

  /** Always keep the one after the destination warm. */
  const goTo = (index: number) => {
    setActive(index);
    setMounted((seen) =>
      seen.has(index) && seen.has((index + 1) % N)
        ? seen
        : new Set([...seen, index, (index + 1) % N]),
    );
  };
  const pick = (index: number) => goTo(index);
  const step = (delta: number) => goTo((active + delta + N) % N);

  return (
    <section
      aria-label="What you can use it for"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* The stem is an EYEBROW, not half of a sentence sharing a line with
        * the phrase. Demoting it is what gives the wheel below something to
        * be bigger than — the two were within a pixel of each other before,
        * and a reader could not tell the scaffolding from the payload. */}
      <p className="text-center font-mono text-[10px] tracking-[0.18em] uppercase">
        you can use artifactbin to
      </p>
      {/* Three rows tall, the middle one live, the whole thing centred: the
        * phrase changes length every few seconds, and centred it re-balances
        * around one axis instead of leaving a ragged right edge that moves. */}
      <div className="use-wheel-window mt-2">
        <div
          className="use-wheel"
          style={{ transform: `translateY(calc(-1 * ${centre - 1} * var(--use-line)))` }}
        >
          {TRIPLE.map((item, index) => (
            <span
              key={index}
              data-use-row=""
              data-state={index === centre ? 'in' : 'out'}
              aria-hidden={index === centre ? undefined : true}
              className="use-row block truncate px-2 font-serif text-[clamp(1.6rem,3.6vw,2.4rem)] font-medium tracking-[-0.005em]"
            >
              {item.use}
            </span>
          ))}
        </div>
      </div>

      {/* The document that IS that example. One picture, swapped — a strip of
        * six would be a gallery again and would stop illustrating the line. */}
      <div className="group/card mt-4">
        {/* The frame is the positioning context for the two overlay controls,
          * and they are SIBLINGS of the link rather than children of it: a
          * button inside an anchor is invalid, and every click on one would
          * open the document instead of stepping the carousel. */}
        <div className="relative overflow-hidden rounded-[6px] border border-edge bg-surface transition-colors group-hover/card:border-accent">
          <a
            href={showcaseHref(doc)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${doc.title}`}
            className="block no-underline"
          >
            {/* The captures that have been reached share one grid cell, so a
              * swap is a cross-fade between two decoded images rather than a
              * flash of empty card on a ~160 KB fetch. What is NOT mounted
              * costs nothing — see `mounted` above. */}
            <div className="grid aspect-[1600/840] w-full">
              {SHOWCASE.filter((_, index) => mounted.has(index)).map((item) => {
                const index = SHOWCASE.indexOf(item);
                return (
                  <img
                    key={item.order}
                    src={showcaseCardUrl(item)}
                    alt=""
                    // The first is what the reader is waiting on; the rest are
                    // warmed a step ahead and must not compete with it.
                    fetchPriority={index === 0 ? 'high' : 'low'}
                    decoding="async"
                    data-state={index === active ? 'in' : 'out'}
                    className="use-shot col-start-1 row-start-1 h-full w-full object-cover object-top"
                  />
                );
              })}
            </div>
          </a>
          <button aria-label="Previous example" onClick={() => step(-1)} className={`${ARROW} left-2`}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Next example" onClick={() => step(1)} className={`${ARROW} right-2`}>
            <ChevronRight size={16} />
          </button>
        </div>
        <a
          href={showcaseHref(doc)}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          aria-hidden
          className="mt-2.5 flex items-baseline gap-3 no-underline"
        >
          <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-fg transition-colors group-hover/card:text-accent">
            {doc.title}
          </span>
          <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
            {doc.kind} ↗
          </span>
        </a>
      </div>

      {/* The index, as marks rather than words: the wheel already says what
        * each one is, so a second set of labels would repeat it. Stepping is
        * done on the picture. */}
      <div role="group" aria-label="Examples" className="mt-3 flex items-center gap-1.5">
        <>
          {SHOWCASE.map((item, index) => (
            <button
              key={item.order}
              aria-label={`Show ${item.title}`}
              aria-pressed={index === active}
              onClick={() => pick(index)}
              className={`h-1 flex-1 cursor-pointer rounded-full border-0 p-0 transition-colors ${
                index === active ? 'bg-accent' : 'bg-edge-bright hover:bg-muted'
              }`}
            />
          ))}
        </>
      </div>
    </section>
  );
}
