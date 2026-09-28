/**
 * The deck's framework-free chrome behaviour (lib/islands/deck, `@mx/deck`): the rail and the
 * present bar are static server HTML; this marks the active slide, pages on clicks and keys, and on
 * a deck with no island module signals ready itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { startDeck } from '../deck';

const deck = (withData: boolean) => {
  document.documentElement.removeAttribute('data-mx-ready');
  // Each rail row holds a real miniature of its slide, stamps included (compiler: the rail renders the slide's nodes).
  document.body.innerHTML = '<div class="mx-deck"><nav class="mx-rail" aria-label="Slides">'
    + [0, 1, 2].map((i) => `<button type="button" class="mx-rail-row" aria-current="${i === 0}">${i + 1}<span class="mx-rail-thumb"><section data-mx-slide="">t${i}</section></span></button>`).join('')
    + '</nav><div class="mx-doc">' + [0, 1, 2].map((i) => `<section data-mx-slide="${i}">s${i}</section>`).join('') + '</div>'
    + '<div class="mx-present"><button aria-label="Previous slide">‹</button><span class="mx-present-count">1 / 3</span><button aria-label="Next slide">›</button><button aria-label="Present">present</button></div></div>'
    + (withData ? '<script type="application/json" id="mx-story-data">{}</script>' : '');
  const slides = [...document.querySelectorAll<HTMLElement>('.mx-doc [data-mx-slide]')];
  const scrolled = slides.map((s) => (s.scrollIntoView = vi.fn()));
  return { slides, scrolled, rows: [...document.querySelectorAll<HTMLElement>('.mx-rail-row')] };
};

describe('startDeck', () => {
  it('follows the scroll position, pages on the rail, the bar and the keys, and ignores keys typed into a field', () => {
    const { slides, scrolled, rows } = deck(false);
    slides.forEach((s, i) => { s.getBoundingClientRect = () => ({ top: i === 0 ? -900 : i === 1 ? 10 : 900 }) as DOMRect; });
    const stop = startDeck();
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual(['false', 'true', 'false']);
    expect(document.querySelector('.mx-present-count')?.textContent).toBe('2 / 3');

    rows[2]!.click();
    expect(scrolled[2]).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLElement>('[aria-label="Next slide"]')!.click();
    expect(scrolled[2]).toHaveBeenCalledTimes(2);
    document.querySelector<HTMLElement>('[aria-label="Previous slide"]')!.click();
    expect(scrolled[0]).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(scrolled[2]).toHaveBeenCalledTimes(3);

    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(scrolled[0]).toHaveBeenCalledTimes(1);

    stop();
    rows[0]!.click();
    expect(scrolled[0], 'stopped: no listener left').toHaveBeenCalledTimes(1);
  });

  it('counts only the document\'s slides, not the miniatures in the rail', () => {
    const { slides, rows } = deck(false);
    slides.forEach((s, i) => { s.getBoundingClientRect = () => ({ top: i === 0 ? 0 : 900 * i }) as DOMRect; });
    // A miniature sits high in the rail: counted as a slide, it would become the active one.
    document.querySelectorAll<HTMLElement>('.mx-rail [data-mx-slide]').forEach((t) => { t.getBoundingClientRect = () => ({ top: 0 }) as DOMRect; });
    const stop = startDeck();
    expect(document.querySelector('.mx-present-count')?.textContent).toBe('1 / 3');
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual(['true', 'false', 'false']);
    stop();
  });

  it('signals ready on a deck with no island module, and leaves that to boot when there is one', () => {
    deck(false);
    const ready = vi.fn();
    document.addEventListener('mx:ready', ready);
    startDeck()();
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);

    deck(true);
    startDeck()();
    expect(document.documentElement.hasAttribute('data-mx-ready')).toBe(false);
    expect(ready).toHaveBeenCalledTimes(1);
    document.removeEventListener('mx:ready', ready);
  });
});
