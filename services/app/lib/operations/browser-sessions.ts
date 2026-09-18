import { z } from 'zod';
import { services } from '@/lib/services';
import type { Actor, BrowserSessionRequest, ViewerChoice } from '@artifactbin/contracts';
import { TESTUSER_ERRORS } from '@artifactbin/contracts';
import { resolveTestUser, sweepTestUsers } from '@/lib/testusers';
import { forgetTestUserSession, noteTestUserSession } from '@/lib/testuser-sessions';
import type { Operation } from './registry';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
/**
 * The viewers a session's PAGES can browse as; anything else is refused before
 * the service sees it (it reads an unrecognized viewer as none, which would
 * quietly browse as the caller).
 *
 * A session MINTS NOTHING now. `viewer: {testuser}` NAMES one of the caller's
 * own test users (testuser_create), which exists before the session and outlives
 * it — so the same person can be driven from a session, from a bearer call and
 * through a fork, and deleting it is one act that erases everything it did.
 */
const VIEWER = z.union([z.literal('guest'), z.object({ testuser: z.string().min(1) })]);
/** Session lifecycle has its own execution receipts, independent of artifact source mutations. */
export const BROWSER_SESSION_OPERATIONS: Operation[] = [{
  name: 'browser_session', title: 'Operate a live browser session',
  http: { method: 'POST', path: '/api/browser-sessions' },
  description: 'Run an async Playwright function body in a persistent isolated browser. A script returns an execution receipt immediately; poll status with its session_id and execution_id. Multiple artifact pages share one session. Existing effects survive script errors; lost sessions are never recreated or replayed automatically. The session browses as you unless the request that creates it names a viewer: "guest" fetches its pages signed out — how to see what a public reader sees, with a guest\'s writes refused — and {"testuser": "ID"} browses as one of your test users (testuser_create), which is how to be a SECOND person on a page. Fork the page as that test user first (fork_artifact with as), because a test user acts only inside its own sandbox. Who a session browses as is fixed when it is created; naming a different viewer later is refused.',
  input: { op: z.enum(['script', 'status', 'close']), session_id: id, execution_id: id.optional(), create: z.boolean().optional(), code: z.string().max(65536).optional(), viewer: VIEWER.optional() },
  annotations: {},
  example: { input: { op: 'status', session_id: 'session-id' } },
  errors: [
    { status: 400, code: 'invalid_viewer', fix: 'Pass viewer "guest" or {"testuser": "ID"} on the request that CREATES the session, or omit it to browse as yourself.' },
    { status: 403, code: TESTUSER_ERRORS.notYours, fix: 'The viewer names a test user that is not yours. List your own with testuser_list, or mint one with testuser_create.' },
    { status: 403, code: TESTUSER_ERRORS.expired, fix: 'That test user has expired and been erased with everything it owned. Mint another with testuser_create and fork the page as it again.' },
  ],
  async run(ctx, input) {
    const sessionService = services().browser.sessions;
    if (!sessionService) return { status: 503, body: { error: 'sessions_unavailable' } };
    if (input.op === 'script' && (typeof input.execution_id !== 'string' || typeof input.code !== 'string')) return { status: 400, body: { error: 'invalid_script', message: 'script requires execution_id and code' } };
    const asked = input.viewer === undefined ? undefined : VIEWER.safeParse(input.viewer);
    if (asked && !asked.success) {
      return { status: 400, body: { error: 'invalid_viewer', message: 'viewer is "guest", {"testuser": "ID"} or absent; a session omitting it browses as you' } };
    }
    const viewer: ViewerChoice | undefined = asked?.success ? asked.data : undefined;
    const actor = { credential: 'bearer', ...ctx.actor } as Actor;
    const sessionId = String(input.session_id);
    // Every call is a chance to notice the test users nobody will ever delete.
    // It can never fail the call: `status` is the disconnect-recovery path.
    await sweepTestUsers();

    /*
     * A NAMED test user is verified on the request that CREATES the session and
     * nowhere else: a resume names the viewer the session already has, and its
     * pages were bound to that identity when the worker started. Ownership and
     * liveness are one question, asked once, in lib/testusers.
     */
    let pageActor: Actor | undefined;
    let browsingAs: string | undefined;
    if (input.op === 'script' && viewer && typeof viewer === 'object' && input.create === true) {
      const resolved = await resolveTestUser(ctx.actor.userId ?? null, viewer.testuser);
      if (resolved === TESTUSER_ERRORS.notYours) return { status: 403, body: { error: TESTUSER_ERRORS.notYours, message: `${viewer.testuser} is not one of your test users. List them with testuser_list, or mint one with testuser_create.` } };
      if (resolved === TESTUSER_ERRORS.expired) return { status: 403, body: { error: TESTUSER_ERRORS.expired, message: `Test user ${viewer.testuser} has expired and been erased. Mint another with testuser_create.` } };
      pageActor = { credential: 'bearer', tokenId: resolved.tokenId, userId: resolved.id };
      browsingAs = resolved.id;
      // The register is what lets an ERASE end the sessions browsing as this
      // person, and what the `sessions` count on testuser_list reads.
      noteTestUserSession(resolved.id, sessionId, actor);
    }

    const request = { ...input, actor, ...(pageActor ? { pageActor } : {}) } as BrowserSessionRequest;
    const result = await sessionService.request(request);
    // The session never started, so nothing will ever close it: stop naming it
    // now rather than leaving a register entry a later erase would act on.
    if (browsingAs && result.error) forgetTestUserSession(browsingAs, sessionId);
    // `result` carries pages, receipts and errors — never the token behind
    // pageActor, which this operation is the only holder of.
    return { status: 200, body: { ...result } };
  },
}];
