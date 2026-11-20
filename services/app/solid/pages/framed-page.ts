/**
 * THE SERVED DOCUMENT FRAME, ON THE DOCUMENT PAGE: adopted where the server drew it, laid out around, and told the address's fragment.
 *
 * The served frame is never moved: it stays where the server drew it, a child of <body>. A frame taken out of the
 * document and put back is a NEW frame that loads its first URL again — every browser without `moveBefore` (Safari,
 * Firefox) does that — and that URL's one-time ticket was spent by the first load. So the page lays out around the
 * frame instead: the frame's host is the viewport (fixed under the bar, leaving the rail its width, on the document's
 * own ground), and a slot for page notices is drawn in it, above the frame, so the frame shrinks to make room.
 *
 * The frame's page behaviour reads the address's `#hash` (never `#edit`, the app's own). An `#af-state=` link opens the
 * framed page with that state once: the frame's address takes the fragment (lib/html-runtime/bridge/reader) and its
 * `@afbin/state` seeds from it. Once the frame's controller runs it has it, and this address drops it, so the frame's
 * next load (a reload, a rebuilt version) keeps the reader's own state.
 *
 * Interface: `createFramedPage({ origin, top, right, ground })` → `{ adopt, frame, slot, forwardHash, settleStateFragment }`.
 */
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { STORY_FRAME_HASH_MESSAGE } from '@/lib/html-reader/contract';
import { adoptServedFrame } from '@/solid/pages/served-frame';
import { framedDocumentFor } from '../document/frame-src';

export function createFramedPage(options: { origin: string | null; top: number; right: () => number; ground: () => string }) {
  const [host, setHost] = createSignal<HTMLElement>();
  const [slot, setSlot] = createSignal<HTMLElement | null>(null);
  const [frame, setFrame] = createSignal<HTMLIFrameElement | null>(null);
  // The frame scrolls beneath the bar; the comments rail reserves its own width.
  createEffect(() => {
    const viewport = host();
    if (!viewport) return;
    Object.assign(viewport.style, {
      position: 'fixed', top: `${options.top}px`, left: '0px', right: options.right() ? `${options.right()}px` : '0px', bottom: '0px',
      display: 'flex', flexDirection: 'column', background: options.ground(), padding: '0px', minHeight: '0px',
    });
  });
  const forwardHash = () => {
    const hash = window.location.hash;
    const target = frame()?.contentWindow;
    if (hash && hash !== '#edit' && target && options.origin) target.postMessage({ type: STORY_FRAME_HASH_MESSAGE, hash }, options.origin);
  };
  return {
    /** Take the frame the server drew (removed again on cleanup); null when there is none. Call once, on mount. */
    adopt: () => {
      const served = adoptServedFrame();
      const framed = served ? framedDocumentFor(served, options.origin) : null;
      if (!served || !framed) return null;
      const notices = document.createElement('div');
      notices.setAttribute('data-mx-frame-slot', '');
      notices.style.flex = '0 0 auto';
      served.insertBefore(notices, served.firstChild);
      served.setAttribute('aria-label', 'Artifact viewport');
      setHost(served);
      setSlot(notices);
      setFrame(framed.frame);
      onCleanup(() => served.remove());
      return framed;
    },
    /** The document's frame, once adopted. */
    frame,
    /** The slot ABOVE the frame, in the layout rather than over it (page notices portal into it). */
    slot,
    /** Send the address's fragment to the frame (on load, on a hash change). */
    forwardHash,
    /** Hand an `#af-state=` fragment to the frame once, then drop it from this address. */
    settleStateFragment: () => {
      const { pathname, search, hash } = window.location;
      if (!/^#(?:.*&)?af-state=/.test(hash)) return;
      forwardHash();
      const rest = hash.slice(1).split('&').filter((part) => !part.startsWith('af-state=')).join('&');
      window.history.replaceState(window.history.state, '', `${pathname}${search}${rest ? `#${rest}` : ''}`);
    },
  };
}
