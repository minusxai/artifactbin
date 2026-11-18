/**
 * A DRAFT, CHECKED: the page and its files made a draft for no reader (a fresh name each time, so no reader's caps
 * count it), loaded once in the app's own browser under its draft origin, fetched from this process
 * (EXPORT_INTERNAL_ORIGIN, contracts PageInspectRequest), then forgotten. The answer is the page's own problems
 * (failed components, exceptions, console errors, failed requests) and a JPEG of it, for an author who can look.
 * Nothing is read as anyone: a `default:` link is never allowed here, so its consent refusal, in a component or a
 * script, is no problem. A page that did not finish in time is not checked (a busy browser is not the page's fault).
 */
import { randomUUID } from 'node:crypto';
import { SQL_FAILURES, type PageImage, type PageProblem } from '@artifactbin/contracts';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN, services } from '@/lib/platform';
import { draftOriginFor, pagesFrameUrl, pagesSite } from '@/lib/http';
import { createDraft, forgetDraft } from './drafts';

/** What a check answers: the problems, or that the browser could not look (`check_unavailable`). */
type DraftCheck = { ok: true; problems: PageProblem[]; truncated: boolean; image?: PageImage } | { ok: false; error: 'check_unavailable' };

/** How long the browser gets for one check, and its settle: an agent's relay counts every call's time in a small
 * per-run budget, so a check stays short (a page that needs longer is answered not checked). */
const CHECK_TIMEOUT_MS = 10_000, CHECK_SETTLE_MS = 300;

/** Check `input` (DraftInput without `liveSql`); a draft the store refuses throws its DraftRefusal. */
export async function checkDraft(input: unknown): Promise<DraftCheck> {
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
    });
    if (!looked.ok) return { ok: false, error: 'check_unavailable' };
    const paused = SQL_FAILURES.consent_required.notice;
    const problems = looked.problems.filter((problem) => problem.code !== 'consent_required' && !problem.message.includes(paused));
    const timedOut = problems.some((problem) => problem.kind === 'timeout'), found = problems.filter((problem) => problem.kind !== 'timeout');
    if (timedOut && !found.length) return { ok: false, error: 'check_unavailable' };
    return { ok: true, problems: found, truncated: looked.truncated, ...(looked.image ? { image: looked.image } : {}) };
  } finally {
    forgetDraft(label);
  }
}
