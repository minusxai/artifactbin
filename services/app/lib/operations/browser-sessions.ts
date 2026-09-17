import { z } from 'zod';
import { services } from '@/lib/services';
import type { BrowserSessionRequest } from '@artifactbin/contracts';
import type { Operation } from './registry';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
/** Session lifecycle has its own execution receipts, independent of artifact source mutations. */
export const BROWSER_SESSION_OPERATIONS: Operation[] = [{
  name: 'browser_session', title: 'Operate a live browser session',
  http: { method: 'POST', path: '/api/browser-sessions' },
  description: 'Run an async Playwright function body in a persistent isolated browser. A script returns an execution receipt immediately; poll status with its session_id and execution_id. Multiple artifact pages share one session. Existing effects survive script errors; lost sessions are never recreated or replayed automatically.',
  input: { op: z.enum(['script', 'status', 'close']), session_id: id, execution_id: id.optional(), create: z.boolean().optional(), code: z.string().max(65536).optional() },
  annotations: {}, example: { input: { op: 'status', session_id: 'session-id' } }, errors: [],
  async run(ctx, input) {
    const sessionService = services().browser.sessions;
    if (!sessionService) return { status: 503, body: { error: 'sessions_unavailable' } };
    if (input.op === 'script' && (typeof input.execution_id !== 'string' || typeof input.code !== 'string')) return { status: 400, body: { error: 'invalid_script', message: 'script requires execution_id and code' } };
    const request = { ...input, actor: { credential: 'bearer', ...ctx.actor } } as BrowserSessionRequest;
    const result = await sessionService.request(request);
    return { status: 200, body: { ...result } };
  },
}];
