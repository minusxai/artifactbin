/**
 * lib/islands' browser leaves not pinned elsewhere: the page contract's attributes and events, the DOM morph's
 * matching (render ids, held nodes, children and attributes), the kit's tooltip timing and arrow geometry, popper
 * placement, popup dismissal, the dialog shell, the trusted layer attribute and the live-update reload fallback.
 * Each test leaves the shared jsdom as it found it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { STORY_FRAMED_ATTR } from '..';
import { ISLANDS_READY_EVENT, LINKED_BASE_SELECTOR, LIVE_DIRECT_ATTR } from '../contract';
import { heldNodes, HK, morphChildren, renderIdOf, syncAttributes } from '../morph/dom';
import { ARROW_ORIGIN, ARROW_TRANSFORM, createTooltipTiming, OPPOSITE } from '../kit/tooltip-core';
import { placePopper } from '../kit/popper';
import { popupDismiss } from '../kit/popup-dismiss';
import { createDialogShell } from '../kit/dialog-shell';
import { TRUSTED_LAYER_ATTR } from '../trusted-portal';
import { reloadKeepingPlace } from '../live-update';

const html = (markup: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host;
};
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe('the page contract', () => {
  it('pins the attributes and events both sides read', () => {
    expect(STORY_FRAMED_ATTR).toBe('data-mx-framed');
    expect(LIVE_DIRECT_ATTR).toBe('data-mx-live-direct');
    expect(ISLANDS_READY_EVENT).toBe('mx:ready');
    expect(TRUSTED_LAYER_ATTR).toBe('data-trusted-layer');
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet preload" data-mx-base href="/a.css"><link rel="stylesheet" href="/b.css">');
    expect(document.head.querySelectorAll(LINKED_BASE_SELECTOR)).toHaveLength(1);
    document.head.querySelectorAll('link').forEach((link) => link.remove());
  });
});

describe('the DOM morph', () => {
  it('renderIdOf reads the hydration key prefix of an island node only', () => {
    const host = html(`<div ${HK}="s3-0000"></div><div ${HK}="d-0001"></div><div ${HK}="nodash"></div><div ${HK}="-x"></div><div></div>`);
    expect([...host.children].map(renderIdOf)).toEqual(['s3-', null, null, null, null]);
    expect(renderIdOf(document.createTextNode('x'))).toBeNull();
    expect(HK).toBe('data-hk');
  });

  it('heldNodes holds frames, embeds and the focused element, with their ancestors, never the root', () => {
    const host = html('<section><div><iframe></iframe></div></section><p><input id="i"></p><span>free</span>');
    (host.querySelector('#i') as HTMLInputElement).focus();
    const held = heldNodes(host);
    expect(held(host.querySelector('section')!)).toBe(true);
    expect(held(host.querySelector('iframe')!)).toBe(true);
    expect(held(host.querySelector('p')!)).toBe(true);
    expect(held(host.querySelector('span')!)).toBe(false);
    expect(held(host)).toBe(false);
  });

  it('morphChildren makes the children the new ones, keeping matched nodes by id', () => {
    const from = html('<p id="a">A</p><p id="b" class="x">B</p><p id="gone">G</p>');
    const a = from.querySelector('#a'), b = from.querySelector('#b');
    const to = document.createElement('div');
    to.innerHTML = '<p id="b" class="y">B2</p><p id="a">A</p><p id="c">C &amp; é</p>';
    morphChildren(from, to, { keep: new Map(), oldUnits: new Map(), used: new Set(), kept: new Set(), held: heldNodes(from) });
    expect(from.innerHTML).toBe(to.innerHTML);
    expect(from.querySelector('#a')).toBe(a);
    expect(from.querySelector('#b')).toBe(b);
    expect(from.querySelector('#gone')).toBeNull();
  });

  it('morphChildren is idempotent', () => {
    const from = html('<ul><li id="1">one</li><li id="2">two</li></ul>');
    const to = document.createElement('div');
    to.innerHTML = '<ul><li id="2">two</li><li id="1">one!</li></ul>';
    const ctx = () => ({ keep: new Map(), oldUnits: new Map(), used: new Set<Node>(), kept: new Set<Node>(), held: heldNodes(from) });
    morphChildren(from, to, ctx());
    const once = from.innerHTML;
    morphChildren(from, to, ctx());
    expect(from.innerHTML).toBe(once);
    expect(once).toBe(to.innerHTML);
  });

  it('syncAttributes copies the new attributes and drops the old, keeping the reader\'s colour on the story root', () => {
    const from = html('').appendChild(document.createElement('div'));
    from.setAttribute('class', 'story light');
    from.setAttribute('data-old', '1');
    from.setAttribute('data-mx-inline-story', '');
    const to = document.createElement('div');
    to.setAttribute('class', 'story light');
    to.setAttribute('data-new', '2');
    to.setAttribute('data-mx-inline-story', '');
    syncAttributes(from, to, 'dark');
    expect(from.hasAttribute('data-old')).toBe(false);
    expect(from.getAttribute('data-new')).toBe('2');
    expect(from.getAttribute('class')).toContain('dark');
    expect(from.getAttribute('class')).not.toContain('light');
    syncAttributes(from, to, null);
    expect(from.getAttribute('class')).toBe('story light');
  });
});

describe('tooltip timing and arrow geometry', () => {
  it('every side has an opposite, an arrow turn and an origin', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(OPPOSITE[OPPOSITE[side]]).toBe(side);
      expect(typeof ARROW_TRANSFORM[side]).toBe('string');
      expect(typeof ARROW_ORIGIN[side]).toBe('string');
    }
    expect(ARROW_TRANSFORM.bottom).toBe('rotate(180deg)');
    expect(ARROW_ORIGIN.top).toBe('');
  });

  it('opens after the delay on hover, at once on focus, closes on Escape and when another opens', () => {
    vi.useFakeTimers();
    // Solid runs a root's effects once its setup returns: the listeners exist from then on.
    const { t, t2, open, open2, dispose } = createRoot((dispose) => {
      const [open, setOpen] = createSignal(false);
      const [open2, setOpen2] = createSignal(false);
      return { t: createTooltipTiming({ open, setOpen, delay: () => 500 }), t2: createTooltipTiming({ open: open2, setOpen: setOpen2 }), open, open2, dispose };
    });
    // The skip-delay window is module state: start an hour after real time, so a tooltip another test file closed
    // in this worker (at real time) never falls inside it.
    vi.setSystemTime(Date.now() + 3_600_000);
    t.enter();
    vi.advanceTimersByTime(499);
    expect(t.state()).toBe('closed');
    vi.advanceTimersByTime(1);
    expect(t.state()).toBe('delayed-open');
    t.close();
    expect(t.state()).toBe('closed');
    t.enter();
    expect(t.state()).toBe('instant-open');
    t.close();
    vi.advanceTimersByTime(1000);
    t.openNow();
    expect(open()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(open()).toBe(false);
    t.openNow();
    t2.openNow();
    expect([open(), open2()]).toEqual([false, true]);
    dispose();
    t.openNow();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(open()).toBe(true);
  });
});

describe('popper placement', () => {
  it('places the wrapper and reports the side and alignment until cleaned up', async () => {
    const host = html('<button>anchor</button><div><span></span></div>');
    const onPlaced = vi.fn();
    const cleanup = placePopper(host.querySelector('button')!, host.querySelector('div')!, null, { side: 'bottom', align: 'start', sideOffset: 4, collisionPadding: 8, arrowWidth: 10, arrowHeight: 5, onPlaced });
    await vi.waitFor(() => expect(onPlaced).toHaveBeenCalled(), { interval: 1 });
    expect(onPlaced.mock.calls[0]![0]).toMatchObject({ side: expect.any(String), align: expect.any(String) });
    expect(host.querySelector('div')!.style.transform).toMatch(/^translate\(/);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });
});

describe('popup dismissal', () => {
  it('closes on Escape, on a press outside, and when another popup opens; never on a press inside', () => {
    const host = html('<button id="t">t</button><div id="p"><button id="in">in</button></div><button id="out">out</button>');
    const trigger = host.querySelector<HTMLElement>('#t')!, panel = host.querySelector<HTMLElement>('#p')!;
    const press = (selector: string) => host.querySelector(selector)!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    const [open, setOpen] = createSignal(true);
    const close = vi.fn(() => setOpen(false)), cancel = vi.fn(() => setOpen(false));
    const dispose = createRoot((dispose) => { popupDismiss(open, close, () => trigger, () => panel, cancel); return dispose; });
    press('#in');
    expect(close).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    setOpen(true);
    press('#out');
    expect(close).toHaveBeenCalledTimes(1);
    setOpen(true);
    const other = createRoot((disposeOther) => ({ announce: popupDismiss(() => true, () => {}, () => host.querySelector<HTMLElement>('#out')!, () => undefined), disposeOther }));
    other.announce();
    expect(close).toHaveBeenCalledTimes(2);
    // An open popup's capture-phase Escape handler stops propagation: left mounted, it would eat every later Escape.
    other.disposeOther();
    setOpen(true);
    dispose();
    press('#out');
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe('the dialog shell', () => {
  it('focuses first, traps Tab, closes on Escape, locks scroll, and restores both on cleanup', async () => {
    const host = html('<button id="before">before</button><div id="panel"><button id="a">a</button><button id="b">b</button></div>');
    const opener = host.querySelector<HTMLElement>('#before')!;
    opener.focus();
    document.body.style.overflow = 'auto';
    const panel = host.querySelector<HTMLElement>('#panel')!;
    const onClose = vi.fn();
    const dispose = createRoot((dispose) => {
      createDialogShell({ panel: () => panel, onClose, initialFocus: () => host.querySelector<HTMLElement>('#a'), lockScroll: true });
      return dispose;
    });
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('a');
    expect(document.body.style.overflow).toBe('hidden');
    host.querySelector<HTMLElement>('#b')!.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement?.id).toBe('a');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement?.id).toBe('b');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    dispose();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.style.overflow = '';
  });
});

describe('the live-update reload fallback', () => {
  it('parks the given place in the window name, then reloads', () => {
    const reload = vi.fn();
    const win = { name: '', location: { reload } } as unknown as Window;
    reloadKeepingPlace(win, { path: '0.2', fraction: 0.5 });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(win.name).toContain('"anchor":{"path":"0.2","fraction":0.5}');
  });
});
