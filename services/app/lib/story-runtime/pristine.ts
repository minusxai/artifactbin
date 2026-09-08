/**
 * THE CHANNEL THE AUTHOR'S SCRIPT CANNOT REACH.
 *
 * A served document runs the author's own `<script>` in the same realm as the
 * runtime. Once the runtime can also send EDITS to the page — which is what
 * in-place editing means — "the frame said so" stops being good enough: a
 * hostile script is one `top.postMessage(...)` away from writing to someone
 * else's document.
 *
 * The runtime wins that race by existing first. It is what injects the author's
 * script (entry.tsx `runAuthorScript`, after hydration), so anything captured
 * here — in ES-module scope, which a classic script cannot address — is
 * captured before author code exists:
 *
 *  - a NONCE, sent to the parent immediately and never exposed on `window`;
 *  - the `window.parent` REFERENCE (the property is replaceable, so it is read
 *    once; the WindowProxy's own `postMessage` cannot be overwritten from
 *    inside the frame at all — that throws SecurityError, measured);
 *  - the `innerHTML` getter, so reading a host's content cannot be poisoned by
 *    a redefined prototype accessor.
 *
 * Every runtime → parent message goes through `post`, not only edits: a
 * shadowed `window.parent` was measured swallowing 45 of the runtime's own
 * posts (`mx:painted`, `mx:anchor`, `mx:query`). Nothing privileged crossed,
 * but a channel that works only sometimes is not a channel.
 *
 * What this does NOT stop, deliberately: a script can still puppet the editor
 * through trusted UA APIs (`focus()` + `execCommand`). That writes what the
 * editor itself can write — visible text, through the door's sanitizer — and
 * cannot inject a script, touch the Helmet, or persist itself. See
 * seamless-editing-v2.md §5.
 */

/** 128 bits of nonce, hex — long enough that guessing is not a strategy. */
function mintNonce(cryptoImpl: Crypto | undefined): string {
  const bytes = new Uint8Array(16);
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PristineChannel {
  /** This session's secret. Every frame → parent message carries it; it is never put on `window`. */
  readonly nonce: string;
  /** Post to the parent over the captured reference. */
  post(message: unknown): void;
  /** Read an element's innerHTML through the captured getter. */
  innerHtmlOf(el: Element): string;
  /** True when a `MessageEvent.source` is the parent we captured. */
  isParent(source: unknown): boolean;
  /**
   * True when a message is from the parent we captured AND carries the app's
   * own origin. Both halves matter: the source proves WHICH window, the origin
   * proves WHOSE page is in it — and the parent is who the runtime takes
   * edit-mode, document-replacement and selection commands from.
   */
  isFromParent(event: Pick<MessageEvent, 'source' | 'origin'>): boolean;
}

/**
 * Capture the channel. Returns null when there is no parent (a reader's
 * top-level document): nothing to talk to, and no editing there either.
 *
 * MUST be called before the author's script is injected — that ordering is the
 * whole security property, and `entry.tsx` is the only correct caller.
 */
export function capturePristine(win: Window, appOrigin: string): PristineChannel | null {
  const parentWin = win.parent;
  if (!parentWin || parentWin === win) return null;

  const post = parentWin.postMessage.bind(parentWin) as (message: unknown, targetOrigin: string) => void;
  const innerHtmlGetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')?.get;
  const nonce = mintNonce(win.crypto);

  return {
    nonce,
    post(message: unknown) {
      /*
       * ADDRESSED, not broadcast. `'*'` hands every message — the session
       * nonce included — to whoever happens to be framing this document, and
       * the nonce is the whole reason the parent can tell the runtime's edits
       * from the author script's.
       */
      // A frame whose parent has gone away must not take the document down.
      try { post(message, appOrigin); } catch { /* the page is gone; nothing to say */ }
    },
    innerHtmlOf(el: Element): string {
      const raw = innerHtmlGetter ? innerHtmlGetter.call(el) : el.innerHTML;
      return typeof raw === 'string' ? raw : '';
    },
    isParent: (source: unknown) => source === parentWin,
    isFromParent: (event) => event.source === parentWin && event.origin === appOrigin,
  };
}
