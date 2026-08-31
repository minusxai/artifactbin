/**
 * The lowercase HTML tags that can introduce active content or hijack
 * navigation, shared by every gate that handles stored markup.
 *
 * Same reasoning as the sibling `url-attrs.ts`: a list maintained in two places
 * drifts, and the drift is silent.
 *
 * This is a SAVE-time gate (`validateJsx`) and the ONLY one: read time
 * re-renders the stored tree with real React SSR, which re-checks nothing.
 * That is deliberate rather than a gap, and the reason is worth stating
 * plainly:
 *
 *  - a `<script>` in the BODY is not the frightening case it is elsewhere. The
 *    served document already runs an author script on purpose, through the one
 *    sanctioned door (`<Helmet><script>`, lib/story/helmet.ts), inside an
 *    opaque origin under `default-src 'none'`. Rejecting body scripts keeps ONE
 *    door instead of two; it is not what makes author JS safe.
 *  - `<base href>`, `<meta http-equiv>`, `<iframe>`, `<form>` are the ones that
 *    would act on the document itself — retarget every relative link, rewrite
 *    the document's own policy, frame or post elsewhere. Those have no door.
 *
 * Every stored document has passed this gate, so the save-time check covers
 * the whole corpus.
 *
 * ── `<form>`: asked and answered, so it stays ──────────────────────────────
 *
 * The reader's document cannot submit one: `form-action 'none'` is in the CSP
 * (lib/story/markup-csp.ts), so the tag would be inert there and admitting it
 * would merely complete the interactive vocabulary (`button`, `input`,
 * `select` … are all allowed, with author JS to drive them).
 *
 * The EDIT CANVAS is why it does not. That surface is deliberately SAME-ORIGIN
 * — the WYSIWYG needs `contentDocument` — and it carries no sandbox. It DOES
 * carry a CSP (`AGENT_IFRAME_CSP`, written into the canvas document by
 * components/views/shared/AgentHtml.tsx; `default-src 'none'` covers scripts),
 * and that policy carries no `form-action`, so nothing there answers for a
 * form. A stored `<form action="/api/…" method="post">` would render in the
 * owner's canvas as a live, same-origin, cookie-carrying submit one click
 * away, in a document an AGENT may have written. Allowing the tag therefore
 * is not a one-line change: it needs `action` neutralised in the interpreter
 * first.
 *
 * So: denied on purpose, not pending. Revisit only together with the canvas.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';

export const DANGEROUS_TAGS = immutableSet([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
  'frame', 'frameset', 'applet', 'noscript',
]);
