/**
 * A DRAFT, CHECKED: the page and its files made a draft for no reader (a fresh name each time, so no reader's caps
 * count it), loaded once in the app's own browser under its draft origin, fetched from this process
 * (EXPORT_INTERNAL_ORIGIN, contracts PageInspectRequest), then forgotten. The answer is the page's own problems
 * (failed components, exceptions, console errors, failed requests, text too faint to read) and a JPEG of its top
 * within PAGE_IMAGE_LIMITS, for an author who can look.
 * Nothing is read as anyone: a `default:` link is never allowed here, so its consent refusal, in a component or a
 * script, is no problem. A page that did not finish in time is not checked (a busy browser is not the page's fault).
 * Its browser loads only the draft's origin and the app's (the platform libraries and fonts), both fetched from this
 * process with no browser header, cookie or credential; every other address (a CDN, a remote image, an internal host)
 * is refused by that browser before it leaves, and the draft's policy keeps its scripts to its own origin.
 *
 * Two callers: a trusted relay (server/draft-check-seam, as no one) and a signed-in author (app/api/page/drafts/check),
 * who also hears a page wider than its window (`overflow`) and holds at most DRAFT_CHECK_LIMITS of the browser
 * (`holdDraftCheck`).
 */
import { randomUUID } from 'node:crypto';
import { DRAFT_CHECK_KEYS, PAGE_IMAGE_LIMITS, SQL_FAILURES, type PageImage, type PageProblem } from '@artifactbin/contracts';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN, services } from '@/lib/platform';
import { draftOriginFor, pagesFrameUrl, pagesSite } from '@/lib/http';
import { createDraft, DraftRefusal, forgetDraft } from './drafts';

/** What a check answers: the problems, or that the browser could not look (`check_unavailable`). */
type DraftCheck = { ok: true; problems: PageProblem[]; truncated: boolean; image?: PageImage } | { ok: false; error: 'check_unavailable' };

/** How long the browser gets for one check, and its settle: an agent's relay counts every call's time in a small
 * per-run budget, so a check stays short (a page that needs longer is answered not checked). */
const CHECK_TIMEOUT_MS = 10_000, CHECK_SETTLE_MS = 300;

/** Check `input` (DraftInput without `liveSql`); a draft the store refuses throws its DraftRefusal. */
async function checkDraft(input: unknown, options: { overflow?: boolean } = {}): Promise<DraftCheck> {
  const browser = services().browser;
  if (!browser.inspect) return { ok: false, error: 'check_unavailable' };
  const site = pagesSite();
  const body = input && typeof input === 'object' && !Array.isArray(input) ? { ...input, liveSql: false } : input;
  const { label, ticket, entryPath } = await createDraft(`check:${randomUUID()}`, body, site.app);
  try {
    const origin = draftOriginFor(label, site);
    const url = pagesFrameUrl(origin, '', ticket).replace(`${origin}/`, `${origin}/${entryPath.split('/').map(encodeURIComponent).join('/')}`);
    const looked = await browser.inspect({
      url, viewport: { width: 1280, height: 800 }, selector: 'body', sameOriginOnly: true, allowedOrigins: [site.app],
      internalOrigin: EXPORT_INTERNAL_ORIGIN, ...(ASSETS_ORIGIN ? { assetOrigin: ASSETS_ORIGIN } : {}), screenshot: true, settleMs: CHECK_SETTLE_MS, timeoutMs: CHECK_TIMEOUT_MS,
      ...(options.overflow ? { overflow: true } : {}),
    });
    if (!looked.ok) return { ok: false, error: 'check_unavailable' };
    const paused = SQL_FAILURES.consent_required.notice;
    const problems = looked.problems.filter((problem) => problem.code !== 'consent_required' && !problem.message.includes(paused));
    const timedOut = problems.some((problem) => problem.kind === 'timeout'), found = problems.filter((problem) => problem.kind !== 'timeout');
    if (timedOut && !found.length) return { ok: false, error: 'check_unavailable' };
    // An older browser service pictured more of the page than an image reader takes: no picture rather than a refused one.
    const image = looked.image && looked.image.width <= PAGE_IMAGE_LIMITS.width && looked.image.height <= PAGE_IMAGE_LIMITS.height ? looked.image : undefined;
    return { ok: true, problems: found, truncated: looked.truncated, ...(image ? { image } : {}) };
  } finally {
    forgetDraft(label);
  }
}

/**
 * A parsed check body as both callers answer it (contracts DRAFT_CHECK_KEYS, `html` and `files` required): 200
 * `{problems, truncated, image?}`, 400 `bad_request` or the draft's own `{error, message}`, 503 `check_unavailable`.
 */
export async function draftCheckAnswer(body: unknown, options: { overflow?: boolean } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  if (!keys || !keys.includes('html') || !keys.includes('files') || keys.some(k => !(DRAFT_CHECK_KEYS as readonly string[]).includes(k))) return { status: 400, body: { error: 'bad_request' } };
  try {
    const checked = await checkDraft(body, options);
    return checked.ok ? { status: 200, body: { problems: checked.problems, truncated: checked.truncated, ...(checked.image ? { image: checked.image } : {}) } } : { status: 503, body: { error: checked.error } };
  } catch (error) {
    if (error instanceof DraftRefusal) return { status: 400, body: { error: error.code, message: error.message } };
    throw error;
  }
}

/**
 * What one signed-in author may hold of the app's one browser (it also draws every export, one page at a time):
 * checks running at once, for them and for everyone (their checks an hour are lib/allowances draftCheckRateLimited).
 * Past either running cap the answer is 429 `browser_busy` at once, never a queue: a check's time starts when it is
 * asked, so a queued one would only time out.
 */
export const DRAFT_CHECK_LIMITS = { perAuthor: 1, running: 2 } as const;
const running = new Map<string, number>();
let runningTotal = 0;

/** A slot for `author` (a person's id, or a group's sign-in `group:<id>:<level>`): its release, or null when busy. */
export function holdDraftCheck(author: string): (() => void) | null {
  const held = running.get(author) ?? 0;
  if (held >= DRAFT_CHECK_LIMITS.perAuthor || runningTotal >= DRAFT_CHECK_LIMITS.running) return null;
  running.set(author, held + 1); runningTotal++;
  let released = false;
  return () => {
    if (released) return;
    released = true; runningTotal--;
    const left = (running.get(author) ?? 1) - 1;
    if (left > 0) running.set(author, left); else running.delete(author);
  };
}
