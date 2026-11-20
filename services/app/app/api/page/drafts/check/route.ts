/**
 * POST /api/page/drafts/check — a signed-in author's unpublished page, checked in the app's own browser before it is
 * published (lib/page-drafts checkDraft): the trusted relay's body and answer (contracts DRAFT_CHECK_PATH), exactly:
 * `{html, entryPath?, files: [{path, base64, contentType?}]}` in, at most SERVICE_PAYLOAD_LIMIT bytes; `{problems,
 * truncated, image?}` out (contracts PageProblem, PageImage), with `overflow` problems too. The draft is made for no
 * reader and checked as no one: it reads no data, runs no page SQL, and its browser carries none of the caller's
 * cookies or credentials. Nothing is stored or published.
 *
 * Who: a person (session, or a bearer such as a run sign-in) and an agent signed in as a group at either level
 * (server/group-admission); a test user (or any identity not an account) is 403 `account_required`; a guest's or a bare
 * token signs in nowhere, so it and nobody get the uniform 401.
 * Bounds (lib/page-drafts DRAFT_CHECK_LIMITS and draftCheckCharges, lib/allowances draftCheckRateLimited, and the same
 * in the browser service for every app process): the person, also when an agent signs in as their group (its sign-in's
 * issuer), the group at either level and the person's share of it. Refusals are `{error, message}`: 413 `too_large`, 400 `bad_request` or the
 * draft's own code, 429 `browser_busy` (checks already running; retry when they finish) or `rate_limited` (this
 * hour's checks spent), 503 `check_unavailable`. Never cached.
 */
import { SERVICE_PAYLOAD_LIMIT } from '@artifactbin/contracts/payload-limit';
import { BodyTooLargeError, readBody } from '@artifactbin/utils';
import { draftCheckRateLimited, draftChecksPerHour, refundDraftCheck } from '@/lib/allowances';
import { requestActor } from '@/lib/authentication';
import { json } from '@/lib/http';
import { draftCheckAnswer, draftCheckCharges, DRAFT_CHECK_LIMITS, holdDraftCheck } from '@/lib/page-drafts';
import { userKindOf } from '@/lib/user-kinds';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const actor = await requestActor(request);
  if (actor instanceof Response) return actor;
  const author = actor.principalGroup ? actor.principalGroup.issuedBy : actor.userId && await userKindOf(actor.userId) === 'account' ? actor.userId : null;
  if (!author) return json({ error: 'account_required', message: 'Sign in with an account to check a draft.' }, 403, NO_STORE);
  let body: unknown;
  try { body = JSON.parse(await readBody(request, { limit: SERVICE_PAYLOAD_LIMIT, as: 'text' })); } catch (error) {
    return error instanceof BodyTooLargeError
      ? json({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT, message: `the page and its files are over ${SERVICE_PAYLOAD_LIMIT} bytes` }, 413, NO_STORE)
      : json({ error: 'bad_request', message: 'send {html, entryPath?, files}' }, 400, NO_STORE);
  }
  const charge = draftCheckCharges(author, actor.principalGroup?.id ?? null, draftChecksPerHour());
  const busy = json({ error: 'browser_busy', message: `At most ${DRAFT_CHECK_LIMITS.perAuthor} of your draft checks and ${DRAFT_CHECK_LIMITS.running} in all run at once; check again when yours finishes.` }, 429, NO_STORE);
  const spent = json({ error: 'rate_limited', message: `At most ${draftChecksPerHour()} draft checks an hour (and ${draftChecksPerHour() * 5} s of browser time) for you, whichever way you sign in, and a group's own share; try again later.` }, 429, NO_STORE);
  const release = holdDraftCheck(charge.map(({ key }) => key));
  if (!release) return busy;
  try {
    const now = Date.now();
    if (draftCheckRateLimited(charge, now)) return spent;
    const answer = await draftCheckAnswer(body, { overflow: true, charge });
    // Refused by the browser service before it ran: a busy check spends no hour here (its own count spent none).
    if (answer.status === 429) { if (answer.body.error === 'browser_busy') refundDraftCheck(charge, now); return answer.body.error === 'rate_limited' ? spent : busy; }
    return json(answer.status === 400 && answer.body.error === 'bad_request' ? { ...answer.body, message: 'send {html, entryPath?, files}' } : answer.body, answer.status, NO_STORE);
  } finally {
    release();
  }
}
