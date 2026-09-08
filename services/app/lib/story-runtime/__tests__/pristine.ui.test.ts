/**
 * capturePristine — the channel the author's script cannot reach.
 *
 * These assertions mirror what was measured in a real browser against a
 * hostile author script (seamless-editing-v2.md §3b): the nonce never leaks,
 * a shadowed `window.parent` does not redirect the channel, and a poisoned
 * `innerHTML` accessor does not change what the runtime reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { capturePristine } from '../pristine';

/**
 * The origin the document was served from — where its page, and only its page,
 * lives. It has to BE this window's origin: `post` now addresses its target,
 * and a targeted post to any other origin is silently dropped, which is the
 * behaviour being relied on.
 */
const APP = window.location.origin;

let frame: HTMLIFrameElement;
const inner = () => frame.contentWindow as Window;

beforeEach(() => {
  frame = document.createElement('iframe');
  document.body.appendChild(frame);
});
afterEach(() => { frame.remove(); });

describe('who the document will listen to', () => {
  // jsdom hands a frame a DIFFERENT window proxy for its parent than the outer
  // `window` object, so the parent has to be named as the frame sees it.
  const event = (over: Partial<{ source: unknown; origin: string }>) =>
    ({ source: inner().parent, origin: APP, ...over }) as MessageEvent;

  it('takes the parent window AT the app origin', () => {
    const channel = capturePristine(inner(), APP)!;
    expect(channel.isFromParent(event({}))).toBe(true);
  });

  it('REFUSES the same window speaking for another origin', () => {
    // Whoever frames a document is its window.parent, and the parent is who
    // the runtime takes edit-mode and document-replacement commands from. The
    // frame cannot tell one framer from another by looking — but the browser
    // stamps the sender's origin, and only one origin owns this document.
    const channel = capturePristine(inner(), APP)!;
    expect(channel.isFromParent(event({ origin: 'https://evil.example' }))).toBe(false);
    expect(channel.isFromParent(event({ origin: 'null' }))).toBe(false);
    expect(channel.isFromParent(event({ origin: '' }))).toBe(false);
  });

  it('REFUSES the right origin from a window that is not the parent', () => {
    const channel = capturePristine(inner(), APP)!;
    expect(channel.isFromParent(event({ source: inner() }))).toBe(false);
  });

  it('ADDRESSES its posts, so a page at another origin is not told anything', async () => {
    /*
     * `'*'` hands every message — the session nonce included — to whoever
     * happens to be framing the document. Asserted through delivery rather
     * than by spying on postMessage: a targeted post to an origin that is not
     * the receiver's is dropped by the browser, which IS the mechanism.
     */
    const seen: unknown[] = [];
    const onMessage = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === 'mx:probe') seen.push(e.data); };
    window.addEventListener('message', onMessage);
    try {
      capturePristine(inner(), 'https://not-this-page.example')!.post({ type: 'mx:probe', at: 'wrong' });
      capturePristine(inner(), APP)!.post({ type: 'mx:probe', at: 'right' });
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      window.removeEventListener('message', onMessage);
    }
    expect(seen).toEqual([{ type: 'mx:probe', at: 'right' }]);
  });
});

describe('capturePristine', () => {
  it('mints a 128-bit nonce, different every session', () => {
    const a = capturePristine(inner(), APP)!;
    const b = capturePristine(inner(), APP)!;
    expect(a.nonce).toHaveLength(32);
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('is null at top level — a reader\'s document has no parent and no editing', () => {
    expect(capturePristine(window, APP)).toBeNull();
  });

  it('posts to the captured parent even after window.parent is SHADOWED', () => {
    const seen: unknown[] = [];
    window.addEventListener('message', (e) => seen.push(e.data));
    const channel = capturePristine(inner(), APP)!;

    // …the author script's move.
    let hijacked = 0;
    try {
      Object.defineProperty(inner(), 'parent', { value: { postMessage: () => { hijacked++; } }, configurable: true });
    } catch { /* some engines refuse outright, which is also fine */ }

    channel.post({ type: 'mx:probe' });
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(hijacked).toBe(0);
      expect(seen).toContainEqual({ type: 'mx:probe' });
      resolve();
    }, 0));
  });

  it('reads innerHTML through the captured getter, ignoring a poisoned prototype', () => {
    const channel = capturePristine(inner(), APP)!;
    const el = document.createElement('p');
    el.textContent = 'real content';

    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    Object.defineProperty(Element.prototype, 'innerHTML', { get: () => 'POISONED', set: original.set, configurable: true });
    try {
      expect(el.innerHTML).toBe('POISONED');            // the author's view
      expect(channel.innerHtmlOf(el)).toBe('real content'); // the runtime's
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', original);
    }
  });

  it('identifies the parent it CAPTURED and nothing else', () => {
    // Compared against the reference read at capture time, not against
    // `window`: jsdom hands out a distinct proxy for `contentWindow.parent`.
    // In a browser they are the same object, which is the rule the query relay
    // has always used (`e.source === frame.contentWindow`).
    const capturedParent = inner().parent;
    const channel = capturePristine(inner(), APP)!;
    expect(channel.isParent(capturedParent)).toBe(true);
    expect(channel.isParent(inner())).toBe(false);
    expect(channel.isParent(null)).toBe(false);
    expect(channel.isParent({ postMessage() {} })).toBe(false);
  });

  it('keeps identifying the parent it captured after window.parent is shadowed', () => {
    const capturedParent = inner().parent;
    const channel = capturePristine(inner(), APP)!;
    const impostor = { postMessage() {} };
    try {
      Object.defineProperty(inner(), 'parent', { value: impostor, configurable: true });
    } catch { /* refused outright is also fine */ }
    expect(channel.isParent(capturedParent)).toBe(true);
    expect(channel.isParent(impostor)).toBe(false);
  });

  it('never throws when the parent has gone away', () => {
    const channel = capturePristine(inner(), APP)!;
    frame.remove();
    expect(() => channel.post({ type: 'mx:probe' })).not.toThrow();
  });
});
