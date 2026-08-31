/**
 * PREVIEW FEATURES — one opt-in, and it lives in the URL.
 *
 * `?v=2` on any app URL turns the preview on for THAT request. There is no
 * cookie and nothing stored: the flag travels by being RE-APPENDED — to every
 * same-origin `/api/` call the client makes and to every in-app link
 * (lib/features/install.ts) — which is the shape minusx uses for `as_user`,
 * `mode` and `view` (`lib/navigation/url-utils.ts` + `lib/http/fetch-patch.ts`).
 *
 * Why the URL rather than a cookie, which is the tempting shortcut: the URL
 * SAYS what mode the page is in, so copying the address bar hands someone the
 * same mode and stripping the parameter is a complete exit. A cookie is
 * invisible state — it outlives the tab that set it, it is per-browser rather
 * than per-page, two tabs cannot disagree, and "why is this behaving oddly"
 * has no answer you can see. It also makes the server's answer depend on
 * something the caller did not send THIS time, which is exactly the property
 * that makes a stale preview flag hard to reason about.
 *
 * WHAT A FLAG MAY GATE, and what it may not:
 *
 *  - It gates AUTHORING: whether a new capability can be turned on for an
 *    artifact. That is a decision made once, by the owner, with their
 *    credential in hand.
 *  - It NEVER gates READING or SERVING. A published artifact must render the
 *    same for everyone: the link is the deliverable, and a reader who arrives
 *    without `?v=2` — which is every reader, because nobody shares a URL with
 *    a preview flag on it — would otherwise get a document with its charts
 *    empty or its buttons dead, with nothing to say why. A flag that can
 *    break a shared link is not a feature flag, it is an outage with a query
 *    parameter.
 *
 * For writable datasets that lands in exactly one place, which is what makes
 * it cheap: `access: readwrite` may only be SET while the preview is on. A
 * dataset that is not writable refuses every `<Mutation>` at publish (the
 * message names the toggle), and every mutate call besides — so gating the
 * toggle gates the whole feature, with no second check anywhere and nothing
 * to remove later but this file's entry.
 */
/**
 * The DEPLOYMENT default (`PREVIEW__FEATURES=1`) is a server value, so it is
 * read lazily and never at module scope: this module is imported by the
 * browser (the link rewriter, the fetch patch), where `process` does not
 * exist. In a browser the deployment default is simply off — the URL is the
 * only thing that turns the preview on there, which is the rule anyway.
 */
const deploymentDefault = (): boolean => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env ? env.PREVIEW__FEATURES === '1' || env.PREVIEW__FEATURES === '1' : false;
};

/** The query parameter that turns the preview on. `?v=2` on; anything else off. */
export const PREVIEW_PARAM = 'v';
export const PREVIEW_VERSION = '2';


/** Every shape a caller might hold the current query string in. */
export type SearchLike = string | URLSearchParams | Record<string, string | string[] | undefined> | undefined | null;

const paramOf = (search: SearchLike): string | null => {
  if (search === undefined || search === null) return null;
  if (typeof search === 'string') return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(PREVIEW_PARAM);
  if (search instanceof URLSearchParams) return search.get(PREVIEW_PARAM);
  const raw = search[PREVIEW_PARAM];
  return Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
};

/**
 * Is the preview on for this query string? The one predicate; everything else
 * here is a way of getting a query string to it.
 *
 * The deployment default (`PREVIEW_FEATURES=1`) applies only when the URL says
 * nothing — an explicit `?v=1` turns the preview off even on a box that runs
 * with it on, so a single page can always be taken back to production
 * behaviour without redeploying.
 */
export function previewFrom(search: SearchLike): boolean {
  const value = paramOf(search);
  if (value !== null) return value === PREVIEW_VERSION;
  return deploymentDefault();
}

/** …for a Request (every API door). Reads the URL and NOTHING else — no cookie is consulted. */
export function previewEnabled(request: Request): boolean {
  try {
    return previewFrom(new URL(request.url).search);
  } catch {
    return deploymentDefault(); // a non-absolute URL has no params to read
  }
}

/**
 * May this request make a dataset WRITABLE? The whole gate for writable
 * datasets — see the module doc for why one door is enough.
 */
export const canSetDatasetAccess = (request: Request): boolean => previewEnabled(request);


/**
 * Carry the flag from the CURRENT query string onto a target URL — the one
 * function both installers call, and the ported shape of minusx's
 * `preserveParams`.
 *
 * Same-origin targets only: the flag is this app's vocabulary, and appending
 * it to someone else's URL leaks where a reader has been. A target that
 * already carries it is returned unchanged rather than doubled.
 *
 * `search` is passed IN rather than read from `window` so this is pure — and,
 * where a component calls it, so the server and client renders agree
 * (`useSearchParams`, never `window.location`, which is the hydration
 * mismatch minusx's Link.tsx documents).
 */
export function preserveParams(target: string, search: SearchLike): string {
  if (!previewFrom(search) || paramOf(search) === null) return target;
  // A bare origin for resolution only; the return keeps the caller's form.
  const base = 'http://preserve.invalid';
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    return target;
  }
  // Anything not same-origin-relative (an absolute http(s) elsewhere, mailto:,
  // tel:) is left exactly as written.
  if (url.origin !== base) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  url.searchParams.set(PREVIEW_PARAM, PREVIEW_VERSION);
  return `${url.pathname}${url.search}${url.hash}`;
}
