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
import { DRAFT_CHECK_KEYS } from '@artifactbin/contracts/identity-service';
import { PAGE_IMAGE_LIMITS, type CheckCharge, type PageImage, type PageProblem } from '@artifactbin/contracts/browser';
import { SQL_FAILURES } from '@artifactbin/contracts/sql-failures';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN, services } from '@/lib/platform';
import { draftOriginFor, pagesFrameUrl, pagesSite } from '@/lib/http';
import { createDraft, DraftRefusal, forgetDraft } from './drafts';

/** What a check answers: the problems, or that the browser could not look (`check_unavailable`), had no room for it
 * (`browser_busy`) or that a charge's hour is spent (`rate_limited`). */
type DraftCheck = { ok: true; problems: PageProblem[]; truncated: boolean; image?: PageImage } | { ok: false; error: 'check_unavailable' | 'browser_busy' | 'rate_limited' };
type CheckOptions = { overflow?: boolean; charge?: CheckCharge[] };

/** How long the browser gets for one check, and its settle: an agent's relay counts every call's time in a small
 * per-run budget, so a check stays short (a page that needs longer is answered not checked). */
const CHECK_TIMEOUT_MS = 10_000, CHECK_SETTLE_MS = 300;

/** Check `input` (DraftInput without `liveSql`); a draft the store refuses throws its DraftRefusal. */
async function checkDraft(input: unknown, options: CheckOptions = {}): Promise<DraftCheck> {
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
      ...(options.overflow ? { overflow: true } : {}), ...(options.charge ? { charge: options.charge } : {}),
    });
    if (!looked.ok) return { ok: false, error: looked.reason === 'busy' ? 'browser_busy' : looked.reason === 'rate_limited' ? 'rate_limited' : 'check_unavailable' };
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
 * `{problems, truncated, image?}`, 400 `bad_request` or the draft's own `{error, message}`, 503 `check_unavailable`;
 * with charges (a signed-in author), the browser service's refusals are 429 `browser_busy` and `rate_limited`, and
 * without (the relay) the same 503 as any browser that could not look.
 */
export async function draftCheckAnswer(body: unknown, options: CheckOptions = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  if (!keys || !keys.includes('html') || !keys.includes('files') || keys.some(k => !(DRAFT_CHECK_KEYS as readonly string[]).includes(k))) return { status: 400, body: { error: 'bad_request' } };
  try {
    const checked = await checkDraft(body, options);
    if (checked.ok) return { status: 200, body: { problems: checked.problems, truncated: checked.truncated, ...(checked.image ? { image: checked.image } : {}) } };
    return options.charge && checked.error !== 'check_unavailable' ? { status: 429, body: { error: checked.error } } : { status: 503, body: { error: 'check_unavailable' } };
  } catch (error) {
    if (error instanceof DraftRefusal) return { status: 400, body: { error: error.code, message: error.message } };
    throw error;
  }
}

/**
 * What one signed-in author may hold of the check browser (the browser service's own, apart from the one that draws
 * exports): checks running at once, for each key they are charged to and for everyone in this process. Past either
 * running cap the answer is 429 `browser_busy` at once, never a queue: a check's time starts when it is asked, so a
 * queued one would only time out. The browser service holds the same caps for every app process at once
 * (contracts CheckCharge); these hold too against an older one.
 */
export const DRAFT_CHECK_LIMITS = { perAuthor: 1, running: 2 } as const;
const running = new Map<string, number>();
let runningTotal = 0;

/**
 * What a signed-in check is charged to, each key with its hour (`perHour` checks, and `perHour` x 5 s of browser time):
 * the PERSON, whatever they sign in as (a group agent's checks count against the person who issued its sign-in too),
 * and for a group's sign-in the GROUP at either level (twice a person's), and the person's share of it (two thirds of
 * a person's), so its members share it and none spends it for all.
 */
export function draftCheckCharges(person: string, group: string | null, perHour: number): CheckCharge[] {
  const share = (key: string, checks: number): CheckCharge => ({ key, perHour: checks, msPerHour: checks * 5_000 });
  return [share(`person:${person}`, perHour), ...(group ? [share(`group:${group}`, perHour * 2), share(`group:${group}:by:${person}`, Math.max(1, Math.ceil(perHour * 2 / 3)))] : [])];
}

/** A slot for every key a check is charged to: its release, or null when one of them (or this process) is busy. */
export function holdDraftCheck(keys: readonly string[]): (() => void) | null {
  if (runningTotal >= DRAFT_CHECK_LIMITS.running || keys.some((key) => (running.get(key) ?? 0) >= DRAFT_CHECK_LIMITS.perAuthor)) return null;
  for (const key of keys) running.set(key, (running.get(key) ?? 0) + 1);
  runningTotal++;
  let released = false;
  return () => {
    if (released) return;
    released = true; runningTotal--;
    for (const key of keys) { const left = (running.get(key) ?? 1) - 1; if (left > 0) running.set(key, left); else running.delete(key); }
  };
}
