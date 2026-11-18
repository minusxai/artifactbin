/**
 * A DRAFT, CHECKED: the page and its files made a draft for no reader (a fresh name each time, so no reader's caps
 * count it), loaded once in the app's own browser under its draft origin, fetched from this process
 * (EXPORT_INTERNAL_ORIGIN, contracts PageInspectRequest), then forgotten. The answer is the page's own problems
 * (failed components, exceptions, console errors, failed or refused requests, a page that never finished drawing).
 * Nothing is read as anyone: a `default:` link is never allowed here, so a component refused for consent is no problem.
 */
import { randomUUID } from 'node:crypto';
import type { PageProblem } from '@artifactbin/contracts';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN, services } from '@/lib/platform';
import { draftOriginFor, pagesFrameUrl, pagesSite } from '@/lib/http';
import { createDraft, forgetDraft } from './drafts';

/** What a check answers: the problems, or that the browser could not look (`check_unavailable`). */
type DraftCheck = { ok: true; problems: PageProblem[]; truncated: boolean } | { ok: false; error: 'check_unavailable' };

/** How long the browser gets for one check: a relay cuts the whole call at 35 s. */
const CHECK_TIMEOUT_MS = 15_000;

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
      internalOrigin: EXPORT_INTERNAL_ORIGIN, ...(ASSETS_ORIGIN ? { assetOrigin: ASSETS_ORIGIN } : {}), timeoutMs: CHECK_TIMEOUT_MS,
    });
    if (!looked.ok) return { ok: false, error: 'check_unavailable' };
    return { ok: true, problems: looked.problems.filter((problem) => problem.code !== 'consent_required'), truncated: looked.truncated };
  } finally {
    forgetDraft(label);
  }
}
