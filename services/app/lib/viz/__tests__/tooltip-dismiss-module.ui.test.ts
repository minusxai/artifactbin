/**
 * The dismiss policy module's OWN behaviour, where the seeded card-level test does not reach:
 * release() really removes every listener, `lastPointerType` is per document, and the offset a
 * touch-opened card is placed at is bigger than a cursor's (the button must not sit under the
 * finger that opened the card).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVegaTooltipHandler } from '@/lib/viz/vega-tooltip-handler';
import {
  installTooltipDismiss,
  lastPointerType,
  decorateForOpener,
  offsetForOpener,
  TOUCH_OFFSET,
} from '@/lib/viz/tooltip-dismiss';

const PE: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent
  ?? (class extends MouseEvent {
    pointerType: string;
    constructor(type: string, init?: PointerEventInit) { super(type, init); this.pointerType = init?.pointerType ?? 'mouse'; }
  } as unknown as typeof PointerEvent);

const pointer = (target: EventTarget, type: string, pointerType: 'mouse' | 'touch' | 'pen') =>
  target.dispatchEvent(new PE(type, { bubbles: true, cancelable: true, pointerType }));

const spy = () => vi.fn(() => {});
type Spy = ReturnType<typeof spy>;

describe('installTooltipDismiss', () => {
  let chart: HTMLElement;
  let outside: HTMLElement;
  let hide: Spy;

  beforeEach(() => {
    document.body.innerHTML = '<main><div id="chart"><svg></svg></div><p id="prose">text</p></main>';
    chart = document.getElementById('chart')!;
    outside = document.getElementById('prose')!;
    hide = spy();
  });

  it('hides on a touchmove outside the chart and not on one inside it', () => {
    const release = installTooltipDismiss(document, chart, hide);
    chart.dispatchEvent(new Event('touchmove', { bubbles: true }));
    expect(hide).not.toHaveBeenCalled();
    outside.dispatchEvent(new Event('touchmove', { bubbles: true }));
    expect(hide).toHaveBeenCalledTimes(1);
    release();
  });

  it('release() removes every listener it installed', () => {
    const release = installTooltipDismiss(document, chart, hide);
    release();
    pointer(document, 'pointercancel', 'touch');
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer(outside, 'pointerdown', 'mouse');
    outside.dispatchEvent(new Event('touchmove', { bubbles: true }));
    expect(hide).not.toHaveBeenCalled();
  });

  it('a scroll in a nested scroller counts (scroll does not bubble; the listener captures)', () => {
    const release = installTooltipDismiss(document, chart, hide);
    chart.dispatchEvent(new Event('scroll')); // non-bubbling, as a real scroller emits it
    expect(hide).toHaveBeenCalledTimes(1);
    release();
  });

  it('a second install for the same document is independent of the first', () => {
    const other = spy();
    const releaseA = installTooltipDismiss(document, chart, hide);
    const releaseB = installTooltipDismiss(document, chart, other);
    releaseA();
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(hide).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    releaseB();
  });
});

describe('lastPointerType', () => {
  it('is remembered per document, and an unseen document reads "unknown"', () => {
    document.body.innerHTML = '<div id="chart"></div>';
    const frame = document.implementation.createHTMLDocument('other');
    expect(lastPointerType(frame)).toBe('unknown');

    pointer(document.getElementById('chart')!, 'pointerdown', 'touch');
    expect(lastPointerType(document)).toBe('touch');
    expect(lastPointerType(frame)).toBe('unknown');

    pointer(frame.body, 'pointerdown', 'pen');
    expect(lastPointerType(frame)).toBe('pen');
    expect(lastPointerType(document)).toBe('touch');

    pointer(document.body, 'pointerdown', 'mouse');
    expect(lastPointerType(document)).toBe('mouse');
  });
});

describe('the offset rule', () => {
  it('places a touch-opened card further from the pointer than a mouse-opened one', () => {
    expect(offsetForOpener('touch', 10)).toBe(TOUCH_OFFSET);
    expect(offsetForOpener('pen', 10)).toBe(TOUCH_OFFSET);
    expect(offsetForOpener('touch', 10)).toBeGreaterThan(offsetForOpener('mouse', 10));
  });

  it('leaves a cursor-opened card exactly where its own card placed it', () => {
    expect(offsetForOpener('mouse', 10)).toBe(10);
    expect(offsetForOpener('unknown', 16)).toBe(16);
    // …and never pulls a touch card CLOSER than the card's own base.
    expect(offsetForOpener('touch', 60)).toBe(60);
  });
});

describe('decorateForOpener', () => {
  let card: HTMLElement;
  let hide: Spy;
  const close = () => card.querySelector<HTMLButtonElement>('button[aria-label="Dismiss tooltip"]');

  beforeEach(() => {
    document.body.innerHTML = '<div id="card"></div>';
    card = document.getElementById('card')!;
    hide = spy();
  });

  it('marks the card so a press inside it is never a press "outside the chart"', () => {
    document.body.innerHTML = '<div id="chart"></div><div id="card"></div>';
    card = document.getElementById('card')!;
    const chart = document.getElementById('chart')!;
    decorateForOpener(card, 'touch', hide);
    const release = installTooltipDismiss(document, chart, hide);
    pointer(close()!, 'pointerdown', 'touch');
    expect(hide).not.toHaveBeenCalled();
    release();
  });

  it('adds ONE close button for touch, keeps it across redecoration, and drops it for a mouse', () => {
    decorateForOpener(card, 'touch', hide);
    decorateForOpener(card, 'touch', hide);
    expect(card.querySelectorAll('button').length).toBe(1);
    close()!.click();
    expect(hide).toHaveBeenCalledTimes(1);

    decorateForOpener(card, 'mouse', hide);
    expect(close()).toBeNull();
    decorateForOpener(card, 'unknown', hide);
    expect(close()).toBeNull();
  });
});

describe('the per-mark handler installs ONE policy per document', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not stack a listener set per rebuild (render-vega builds a handler on every view)', () => {
    document.body.innerHTML = '<div id="chart"><svg></svg></div>';
    const chart = document.getElementById('chart')!;
    const add = vi.spyOn(document, 'addEventListener');
    createVegaTooltipHandler(chart, 'light');
    createVegaTooltipHandler(chart, 'light');
    createVegaTooltipHandler(chart, 'dark');
    const scrolls = add.mock.calls.filter(([type]) => type === 'scroll').length;
    expect(scrolls).toBe(1);
  });
});
