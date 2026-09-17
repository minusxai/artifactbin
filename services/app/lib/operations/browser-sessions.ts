import { z } from 'zod';
import { services } from '@/lib/services';
import type { Actor, BrowserSessionRequest } from '@artifactbin/contracts';
import { createTestUser, releaseTestUser, sweepTestUsers, touchTestUser } from '@/lib/browser-test-user';
import type { Operation } from './registry';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
/** The viewers a session's PAGES can browse as; anything else is refused before the service sees it. */
const VIEWERS = ['guest', 'test-user'] as const;
/** Session lifecycle has its own execution receipts, independent of artifact source mutations. */
export const BROWSER_SESSION_OPERATIONS: Operation[] = [{
  name: 'browser_session', title: 'Operate a live browser session',
  http: { method: 'POST', path: '/api/browser-sessions' },
  description: 'Run an async Playwright function body in a persistent isolated browser. A script returns an execution receipt immediately; poll status with its session_id and execution_id. Multiple artifact pages share one session. Existing effects survive script errors; lost sessions are never recreated or replayed automatically. The session browses as you unless the request that creates it names a viewer: "guest" fetches its pages signed out — how to see what a public reader sees, with a guest\'s writes refused — and "test-user" browses as a fresh account that exists only for this session, which is how to be a SECOND person on a page you already joined. A test user needs an account of your own, one lives at a time, and closing the session ends it. Who a session browses as is fixed when it is created; naming a different viewer later is refused.',
  input: { op: z.enum(['script', 'status', 'close']), session_id: id, execution_id: id.optional(), create: z.boolean().optional(), code: z.string().max(65536).optional(), viewer: z.enum(VIEWERS).optional() },
  annotations: {},
  example: { input: { op: 'status', session_id: 'session-id' } },
  errors: [
    { status: 400, code: 'invalid_viewer', fix: 'Pass viewer "guest" or "test-user" on the request that CREATES the session, or omit it to browse as yourself.' },
    { status: 403, code: 'test_user_requires_account', fix: 'Sign in before asking for a test user; a guest cannot mint a second person. Use viewer "guest" to browse signed out instead.' },
    { status: 409, code: 'test_user_live', fix: 'Close the session named in the message (afbin sessions close SESSION_ID), then create the new test-user session.' },
  ],
  async run(ctx, input) {
    const sessionService = services().browser.sessions;
    if (!sessionService) return { status: 503, body: { error: 'sessions_unavailable' } };
    if (input.op === 'script' && (typeof input.execution_id !== 'string' || typeof input.code !== 'string')) return { status: 400, body: { error: 'invalid_script', message: 'script requires execution_id and code' } };
    // The session service reads an unrecognized viewer as none, which would quietly browse as the caller.
    if (input.viewer !== undefined && !VIEWERS.includes(input.viewer as (typeof VIEWERS)[number])) {
      return { status: 400, body: { error: 'invalid_viewer', message: 'viewer is "guest", "test-user" or absent; a session omitting it browses as you' } };
    }
    const actor = { credential: 'bearer', ...ctx.actor } as Actor;
    const sessionId = String(input.session_id);
    // Every call is a chance to notice a session nobody will ever close. It
    // never fails the call — `status` is the disconnect-recovery path.
    await sweepTestUsers();
    await touchTestUser(sessionId, actor);

    // A second person is minted for the request that CREATES the session and
    // nowhere else: a resume names the viewer the session already has, and its
    // pages were bound to that identity when the worker started.
    let minted: { tokenId: string } | undefined;
    let pageActor: Actor | undefined;
    if (input.op === 'script' && input.viewer === 'test-user' && input.create === true) {
      const created = await createTestUser(sessionId, actor);
      if (!created.ok) return { status: created.status, body: { error: created.error, message: created.message } };
      minted = created;
      pageActor = created.pageActor;
    }

    const request = { ...input, actor, ...(pageActor ? { pageActor } : {}) } as BrowserSessionRequest;
    const result = await sessionService.request(request);
    // The session never started, so nothing will ever close it: end the
    // identity now rather than leaving it to the sweep.
    if (minted && result.error) await releaseTestUser(sessionId, actor);
    // The identity's lifetime IS the session. Revoked after the close, so a
    // refused close leaves the session and its second person as they were.
    if (input.op === 'close' && !result.error) await releaseTestUser(sessionId, actor);
    // `result` carries pages, receipts and errors — never the token or cookie
    // behind pageActor, which this operation is the only holder of.
    return { status: 200, body: { ...result } };
  },
}];
