'use client';

/**
 * "You can use artifactbin to ___" — a picker wheel, with the real published
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
import { useEffect, useRef, useState } from 'react';
import {
  SHOWCASE,
  SHOWCASE_FORMATS,
  showcaseCardUrl,
  showcaseHref,
  type ShowcaseKind,
} from '@/lib/showcase';

/*
 * WHAT PACES THIS IS THE PICTURE, NOT THE LINE. It ran at 1500ms, which suits
 * a phrase on a wheel and not the full screenshot that changes with it: a
 * reader who has not finished looking at one document is not helped by the
 * next arriving.
 */
const INTERVAL = 3200;
const ARROW =
  'absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-accent shadow-sm backdrop-blur-sm transition-colors hover:border-accent hover:bg-accent hover:text-bg';
const N = SHOWCASE.length;
/** The three copies the wheel rides on. */
const TRIPLE = [...SHOWCASE, ...SHOWCASE, ...SHOWCASE];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The rail SAYS the range and MARKS where in it the wheel has got to. Without
 * the mark it was a static list of five words beside a picture that changed —
 * the reader had no way to tell which of the five they were looking at.
 */
function FormatRail({ active, onPick }: { active: ShowcaseKind; onPick: (kind: ShowcaseKind) => void }) {
  return (
    <div className="mt-9 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[11px] sm:gap-x-3 sm:text-xs">
      {SHOWCASE_FORMATS.map((format, index) => (
        <span key={format.kind} className="inline-flex items-center gap-x-2 sm:gap-x-3">
          {index > 0 && <span aria-hidden className="text-faint">/</span>}
          <button
            type="button"
            aria-label={`Show ${format.label}`}
            aria-current={format.kind === active ? 'true' : undefined}
            onClick={() => onPick(format.kind)}
            className={`cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] transition-colors sm:text-xs ${
              format.kind === active
                ? 'text-accent underline decoration-1 underline-offset-4'
                : 'text-muted hover:text-fg'
            }`}
          >
            {format.label}
          </button>
        </span>
      ))}
    </div>
  );
}

function ShowcaseConcept({
  autoplay = false,
}: {
  /** Every option in the rig now moves on its own; kept as a prop because
    * the surviving one may well want it off somewhere. */
  autoplay?: boolean;
}) {
  /**
   * WHERE THE TRACK IS, as a row of TRIPLE — not derived from which document
   * is showing. That derivation (`N + active`) was the wrap: stepping off the
   * last document put the position back at the top of the copy, and the
   * reader watched half a second of the whole list rewinding past them, once
   * a lap. The track only ever moves by the delta it was asked for, so
   * forwards is always forwards; the position is re-seated into the middle
   * copy AFTER the movement lands, with the transition off, which is the one
   * frame nobody can see.
   */
  const [at, setAt] = useState(N);
  /** True for the single frame the re-seat is painted in. */
  const [seating, setSeating] = useState(false);
  /** The move waiting for the re-seat to land, so it can animate from there. */
  const queued = useRef<number | null>(null);
  const active = ((at % N) + N) % N;
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

  useEffect(() => {
    // Restarts whenever `active` changes, so a click gets a full interval
    // before the next automatic step rather than the tail of the last one.
    if (!autoplay || held || prefersReducedMotion() || N < 2) return;
    const id = setInterval(() => step(1), INTERVAL);
    return () => clearInterval(id);
  }, [autoplay, held, at]);

  /**
   * Move by exactly `delta` rows, in that direction, and keep the capture
   * after the destination warm.
   *
   * THE RE-SEAT IS LAZY — it happens before the NEXT move, not after this one.
   * Waiting for `transitionend` was the obvious hook and does not fire here at
   * all (measured in Chrome: zero events on a track that visibly animates), so
   * the track ran off the end of TRIPLE and the wheel went blank after about
   * forty seconds. Instead, a move that starts from outside the middle copy
   * first snaps back onto it with the transition suppressed — the same visual
   * row, so nothing moves — and the real move rides the next frame from there.
   */
  const step = (delta: number) => {
    const index = ((at + delta) % N + N) % N;
    setMounted((seen) =>
      seen.has(index) && seen.has((index + 1) % N)
        ? seen
        : new Set([...seen, index, (index + 1) % N]),
    );
    if (at >= N && at < 2 * N) {
      setAt(at + delta);
      return;
    }
    queued.current = delta;
    setSeating(true);
    setAt(N + active);
  };

  /**
   * A named destination takes the SHORT way round — the reader asked for that
   * document, not for a tour of the four between here and it.
   */
  const goTo = (index: number) => {
    const forward = ((index - active) % N + N) % N;
    step(forward > N / 2 ? forward - N : forward);
  };
  const pick = (index: number) => goTo(index);
  const pickFormat = (kind: ShowcaseKind) => {
    const index = SHOWCASE.findIndex((item) => item.kind === kind);
    if (index >= 0) goTo(index);
  };

  /*
   * The frame boundary the re-seat needs: the snapped position is committed
   * and painted, THEN the queued move starts from it. Both happen in one
   * commit, so the browser animates only the move.
   */
  useEffect(() => {
    if (!seating) return undefined;
    const id = requestAnimationFrame(() => {
      setSeating(false);
      const delta = queued.current;
      queued.current = null;
      if (delta) setAt((row) => row + delta);
    });
    return () => cancelAnimationFrame(id);
  }, [seating]);

  return (
    <article
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* THE LABEL IS THE SEPARATOR. The section needed an edge against the
        * getting-started card above it, and the eyebrow was already floating
        * in the gap doing nothing structural — so the rule runs the column
        * and the label breaks it, rather than adding a divider and keeping a
        * loose caption above it. */}
      <p className="flex items-center gap-4 font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
        <span aria-hidden className="h-px flex-1 bg-edge" />
        using artifactbin you can
        <span aria-hidden className="h-px flex-1 bg-edge" />
      </p>
      <div className="use-wheel-window mt-2">
        <div
          className="use-wheel"
          style={{
            transform: `translateY(calc(-1 * ${at - 1} * var(--use-line)))`,
            ...(seating ? { transition: 'none' } : {}),
          }}
        >
          {TRIPLE.map((item, index) => (
            <span
              key={index}
              data-use-row=""
              data-state={index === at ? 'in' : 'out'}
              aria-hidden={index === at ? undefined : true}
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
      </div>
      <FormatRail active={doc.kind} onPick={pickFormat} />
    </article>
  );
}

/**
 * The section as it ships: the rail says the range and MARKS where the wheel
 * has got to, the wheel names the use, and the picture under it is the real
 * published document. The comparison rig that carried six other directions
 * beside this one is gone — a page still wearing its scaffolding reads as
 * unfinished to anyone who was not in the conversation.
 */
export default function UseCarousel() {
  return (
    <section aria-label="What you can use it for">
      <ShowcaseConcept autoplay />
    </section>
  );
}
