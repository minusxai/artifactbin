/**
 * THE DECK'S CHROME BEHAVIOUR (`@mx/deck`, a compiled page's `behaviors: ['deck']`), with NO
 * framework. The rail and the present bar are server HTML; this tracks the active slide on scroll,
 * keeps thumbnail text leaves in sync, marks `aria-current`, pages on clicks and
 * keys, and toggles fullscreen — the slide rail, present bar and slide chrome. The markup it drives is the compiler's static deck chrome: `.mx-rail .mx-rail-row`,
 * `.mx-present` (with its labelled buttons and `.mx-present-count`) and `[data-mx-slide]` slides.
 *
 * Loaded as a module script on its own. A deck with no islands has no island module, so this chunk
 * is the page's only script and signals ready itself (`data-mx-ready`, `mx:ready`); with islands,
 * `boot` does (the data island is on the page exactly when an island module is).
 */
import { ISLAND_DATA_ID, READER_READY_ATTR } from '@/lib/compiled-page/contract';
import { ISLANDS_READY_EVENT } from './contract';

/**
 * A rail miniature the compiler served inert (compiler RAIL_THUMB_ATTR, the same name): one that holds a button
 * cannot be parsed inside the rail row's button, so it arrives in a `<template>` and is put in place here —
 * the tree the former rail renders.
 */
export const RAIL_THUMB_ATTR = 'data-mx-thumb';

export function startDeck(doc: Document = document, win: Window = window): () => void {
  const revealThumbs = () => {
    for (const held of doc.querySelectorAll<HTMLTemplateElement>(`.mx-rail template[${RAIL_THUMB_ATTR}]`)) held.replaceWith(doc.importNode(held.content, true));
  };
  revealThumbs();
  // The document's slides, NOT the rail's miniatures (a thumbnail renders a real slide, stamps included):
  // (`.mx-doc` slides only).
  const slides = () => [...doc.querySelectorAll<HTMLElement>('.mx-doc [data-mx-slide]')];
  const rows = () => [...doc.querySelectorAll<HTMLElement>('.mx-rail .mx-rail-row')];
  const bar = () => doc.querySelector<HTMLElement>('.mx-present');
  const present = () => bar()?.querySelector<HTMLElement>('[aria-label="Present"],[aria-label="Exit presentation"]') ?? null;
  const column = () => doc.querySelector<HTMLElement>('.mx-doc');
  const syncPreview = () => {
    const currentColumn = column();
    const live = new Map([...currentColumn?.querySelectorAll<HTMLElement>('[data-mx-ast]') ?? []].map((node) => [node.getAttribute('data-mx-ast'), node]));
    const previewSlides = [...doc.querySelectorAll<HTMLElement>('.mx-rail [data-mx-slide]')];
    const liveSlides = [...currentColumn?.querySelectorAll<HTMLElement>('[data-mx-slide]') ?? []];
    for (const preview of doc.querySelectorAll<HTMLElement>('.mx-rail [data-mx-ast]')) {
      const railSlide = preview.closest<HTMLElement>('[data-mx-slide]');
      const index = railSlide ? previewSlides.indexOf(railSlide) : -1;
      const path = preview.getAttribute('data-mx-ast') ?? '';
      const railBase = railSlide?.getAttribute('data-mx-ast') ?? '';
      const docBase = liveSlides[index]?.getAttribute('data-mx-ast') ?? '';
      const source = live.get(railBase && docBase && path.startsWith(railBase) ? docBase + path.slice(railBase.length) : path);
      if (!source || source.tagName !== preview.tagName || source.children.length || preview.children.length) continue;
      if (preview.innerHTML !== source.innerHTML) preview.innerHTML = source.innerHTML;
    }
  };
  syncPreview();
  const previewObserver = new MutationObserver(syncPreview);
  const observeColumn = () => {
    previewObserver.disconnect();
    const currentColumn = column();
    if (currentColumn) previewObserver.observe(currentColumn, { subtree: true, childList: true, characterData: true, attributes: true });
  };
  observeColumn();
  let active = 0;
  const cleanups: Array<() => void> = [];
  const on = <K extends string>(target: EventTarget | null | undefined, type: K, listener: (event: Event) => void, options?: AddEventListenerOptions) => {
    if (!target) return;
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };

  const paint = () => {
    rows().forEach((row, i) => row.setAttribute('aria-current', String(i === active)));
    const count = bar()?.querySelector<HTMLElement>('.mx-present-count');
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

  on(doc, 'click', (event) => {
    const row = (event.target as Element).closest('.mx-rail-row');
    if (row?.closest('.mx-rail')) { go(rows().indexOf(row as HTMLElement)); return; }
    const control = (event.target as Element).closest('.mx-present button');
    if (!control) return;
    const label = control.getAttribute('aria-label');
    if (label === 'Previous slide') go(active - 1);
    else if (label === 'Next slide') go(active + 1);
    else if (label === 'Present' || label === 'Exit presentation') {
      if (doc.fullscreenElement) void doc.exitFullscreen?.();
      else void doc.documentElement.requestFullscreen?.()?.catch(() => {});
    }
  });
  on(doc, 'mx:deck-morphed', (event) => {
    revealThumbs();
    observeColumn();
    syncPreview();
    const id = (event as CustomEvent<{ slideId?: string | null }>).detail?.slideId;
    const index = id ? slides().findIndex((slide) => slide.id === id) : -1;
    if (index >= 0) active = index;
    else onScroll();
    paint();
  });
  on(doc, 'fullscreenchange', () => {
    const full = !!doc.fullscreenElement;
    const button = present();
    button?.setAttribute('aria-label', full ? 'Exit presentation' : 'Present');
    if (button) button.textContent = full ? 'exit' : 'present';
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
  return () => { previewObserver?.disconnect(); for (const cleanup of cleanups.splice(0)) cleanup(); };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.querySelector('.mx-rail')) startDeck();
