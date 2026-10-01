/**
 * THE CHANNEL THE AUTHOR'S SCRIPT CANNOT REACH: how the runtime talks to the page that hosts it.
 *
 * The author's own `<script>` runs in the same realm as the runtime, so every runtime → page message
 * carries the session's `nonce` (lib/story-runtime/island-controller mints it with `runtimeId`), and
 * the page drops anything without it. The nonce is never put on `window`; reading a host's content goes
 * through `innerHtmlOf` so the edit session has one place to read it.
 */
export interface RuntimeChannel {
  /** This session's secret. Every frame → parent message carries it; it is never put on `window`. */
  readonly nonce: string;
  /** Post to the page that hosts the runtime. */
  post(message: unknown): void;
  /** Read an element's innerHTML. */
  innerHtmlOf(el: Element): string;
}
