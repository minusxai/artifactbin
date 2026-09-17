/**
 * B2 — a chart tooltip must be dismissable on touch (SEEDED RED by the orchestrator).
 *
 * Vega's per-mark tooltip (`#vg-tooltip-element`) hides only when Vega calls the
 * handler with an empty value, which it does on scenegraph `mouseout` — an event a
 * tap never produces. On a phone the card then stays pinned (`position: fixed`)
 * and untappable (`pointer-events: none`) until a different mark is tapped. The
 * shared multi-series card (`#mx-shared-tooltip`) has the same hole minus one
 * listener. These tests state the dismiss policy BOTH cards must obey, through
 * their existing public entry points only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createVegaTooltipHandler, hideVegaTooltip } from '@/lib/viz/vega-tooltip-handler';
import { SharedTooltip } from '@/lib/viz/shared-tooltip';

// jsdom may not ship PointerEvent; a MouseEvent carrying `pointerType` is enough here.
const PE: typeof PointerEvent =
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent
  ?? (class extends MouseEvent {
    pointerType: string;
    constructor(type: string, init?: PointerEventInit) { super(type, init); this.pointerType = init?.pointerType ?? 'mouse'; }
  } as unknown as typeof PointerEvent);

const pointer = (target: EventTarget, type: string, pointerType: 'mouse' | 'touch') =>
  target.dispatchEvent(new PE(type, { bubbles: true, cancelable: true, pointerType }));

const CLOSE = 'button[aria-label="Dismiss tooltip"]';

describe('per-mark (vega) tooltip dismissal', () => {
  let chart: HTMLElement;
  let handler: ReturnType<typeof createVegaTooltipHandler>;
  const show = () => {
    handler(null, new MouseEvent('mousemove', { clientX: 40, clientY: 40 }), null, { requests: 2, agent: 'codex' });
    return document.getElementById('vg-tooltip-element')!;
  };
  const shown = (el: HTMLElement) => el.style.visibility === 'visible';

  beforeEach(() => {
    document.body.innerHTML = '<main><div id="chart"><svg></svg></div><p id="prose">text</p></main>';
    chart = document.getElementById('chart')!;
    handler = createVegaTooltipHandler(chart, 'light');
  });

  it('shows on a value and hides on an empty value (the behaviour that already exists)', () => {
    const el = show();
    expect(shown(el)).toBe(true);
    handler(null, new MouseEvent('mouseout'), null, null);
    expect(shown(el)).toBe(false);
  });

  it('a pointercancel anywhere in the document hides it (a touch that turned into a scroll)', () => {
    const el = show();
    pointer(document, 'pointercancel', 'touch');
    expect(shown(el)).toBe(false);
  });

  it('a scroll hides it', () => {
    const el = show();
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(shown(el)).toBe(false);
  });

  it('a pointerdown outside the chart hides it; one inside the chart leaves it', () => {
    const el = show();
    pointer(chart.querySelector('svg')!, 'pointerdown', 'mouse');
    expect(shown(el)).toBe(true);
    pointer(document.getElementById('prose')!, 'pointerdown', 'mouse');
    expect(shown(el)).toBe(false);
  });

  it('Escape hides it', () => {
    const el = show();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown(el)).toBe(false);
  });

  it('opened after a touch it carries a close button that dismisses it; after a mouse it does not', () => {
    pointer(chart, 'pointerdown', 'touch');
    const el = show();
    const close = el.querySelector<HTMLButtonElement>(CLOSE);
    expect(close).not.toBeNull();
    // The card itself stays transparent to the pointer; only the button must be tappable.
    expect(getComputedStyle(close!).pointerEvents).not.toBe('none');
    close!.click();
    expect(shown(el)).toBe(false);

    pointer(chart, 'pointerdown', 'mouse');
    const again = show();
    expect(again.querySelector(CLOSE)).toBeNull();
    expect(again.style.pointerEvents).toBe('none');
  });

  it('hideVegaTooltip(doc) hides it, for a chart tearing down while the card is up', () => {
    const el = show();
    hideVegaTooltip(document);
    expect(shown(el)).toBe(false);
  });
});

describe('shared multi-series tooltip dismissal', () => {
  let chart: HTMLElement;
  const shown = (el: HTMLElement) => el.style.display !== 'none';

  beforeEach(() => {
    document.body.innerHTML = '<main><div id="chart"><svg></svg></div><p id="prose">text</p></main>';
    chart = document.getElementById('chart')!;
  });

  it('a pointercancel, a scroll, or a pointerdown outside the chart hides it', () => {
    const tip = new SharedTooltip('light', document, chart);
    const el = document.getElementById('mx-shared-tooltip')!;
    tip.show('<b>x</b>', 10, 10);
    expect(shown(el)).toBe(true);
    pointer(document, 'pointercancel', 'touch');
    expect(shown(el)).toBe(false);

    tip.show('<b>x</b>', 10, 10);
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(shown(el)).toBe(false);

    tip.show('<b>x</b>', 10, 10);
    pointer(chart.querySelector('svg')!, 'pointerdown', 'mouse');
    expect(shown(el)).toBe(true);
    pointer(document.getElementById('prose')!, 'pointerdown', 'mouse');
    expect(shown(el)).toBe(false);
    tip.destroy();
  });

  it('opened after a touch it carries a close button; destroy() releases its listeners', () => {
    const tip = new SharedTooltip('light', document, chart);
    const el = document.getElementById('mx-shared-tooltip')!;
    pointer(chart, 'pointerdown', 'touch');
    tip.show('<b>x</b>', 10, 10);
    const close = el.querySelector<HTMLButtonElement>(CLOSE);
    expect(close).not.toBeNull();
    close!.click();
    expect(shown(el)).toBe(false);

    tip.destroy();
    // After destroy nothing of this instance may still react: showing through a NEW
    // instance and cancelling must be that instance's doing, not a leaked listener.
    const next = new SharedTooltip('light', document, chart);
    next.show('<b>y</b>', 10, 10);
    expect(shown(el)).toBe(true);
    next.destroy();
  });
});
