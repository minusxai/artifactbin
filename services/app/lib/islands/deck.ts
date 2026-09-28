/**
 * THE DECK'S CHROME BEHAVIOUR (`@mx/deck`, a compiled page's `behaviors: ['deck']`), with NO
 * framework. The rail and the present bar are static server HTML (their thumbnails are big and never
 * change); this only tracks the active slide on scroll, marks `aria-current`, pages on clicks and
 * keys, and toggles fullscreen — what StoryRuntimeApp's SlideRail, PresentBar and useSlideChrome do
 * in React. The markup it drives is the compiler's static deck chrome: `.mx-rail .mx-rail-row`,
 * `.mx-present` (with its labelled buttons and `.mx-present-count`) and `[data-mx-slide]` slides.
 *
 * Loaded as a module script on its own. A deck with no islands has no island module, so this chunk
 * is the page's only script and signals ready itself (`data-mx-ready`, `mx:ready`); with islands,
 * `boot` does (the data island is on the page exactly when an island module is).
 */
import { ISLAND_DATA_ID, READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { ISLANDS_READY_EVENT } from './contract';

export function startDeck(doc: Document = document, win: Window = window): () => void {
  // The document's slides, NOT the rail's miniatures (a thumbnail renders a real slide, stamps included):
  // StoryRuntimeApp documentSlides.
  const slides = () => [...doc.querySelectorAll<HTMLElement>('.mx-doc [data-mx-slide]')];
  const rows = [...doc.querySelectorAll<HTMLElement>('.mx-rail .mx-rail-row')];
  const bar = doc.querySelector<HTMLElement>('.mx-present');
  const count = bar?.querySelector<HTMLElement>('.mx-present-count') ?? null;
  const present = bar?.querySelector<HTMLElement>('[aria-label="Present"],[aria-label="Exit presentation"]') ?? null;
  let active = 0;
  const cleanups: Array<() => void> = [];
  const on = <K extends string>(target: EventTarget | null | undefined, type: K, listener: (event: Event) => void, options?: AddEventListenerOptions) => {
    if (!target) return;
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };

  const paint = () => {
    rows.forEach((row, i) => row.setAttribute('aria-current', String(i === active)));
    if (count) count.textContent = `${active + 1} / ${slides().length}`;
  };
  const onScroll = () => {
    const mark = win.innerHeight / 3;
    let next = 0;
    slides().forEach((el, i) => { if (el.getBoundingClientRect().top <= mark) next = i; });
    if (next !== active) { active = next; paint(); }
  };
  const go = (index: number) => {
    const all = slides();
    all[Math.max(0, Math.min(index, all.length - 1))]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  rows.forEach((row, i) => on(row, 'click', () => go(i)));
  on(bar?.querySelector('[aria-label="Previous slide"]'), 'click', () => go(active - 1));
  on(bar?.querySelector('[aria-label="Next slide"]'), 'click', () => go(active + 1));
  on(present, 'click', () => {
    if (doc.fullscreenElement) void doc.exitFullscreen?.();
    else void doc.documentElement.requestFullscreen?.()?.catch(() => {});
  });
  on(doc, 'fullscreenchange', () => {
    const full = !!doc.fullscreenElement;
    present?.setAttribute('aria-label', full ? 'Exit presentation' : 'Present');
    if (present) present.textContent = full ? 'exit' : 'present';
  });
  on(win, 'keydown', (event) => {
    const e = event as KeyboardEvent;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(active - 1); }
  });
  on(win, 'scroll', onScroll, { passive: true });
  on(win, 'resize', onScroll);
  onScroll();

  if (!doc.getElementById(ISLAND_DATA_ID)) {
    doc.documentElement.setAttribute(READER_READY_ATTR, '');
    doc.dispatchEvent(new Event(ISLANDS_READY_EVENT));
  }
  return () => { for (const cleanup of cleanups.splice(0)) cleanup(); };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startDeck();
