import { z } from 'zod';
import { remoteSessions, RemoteError } from '@/lib/remote/registry';
import { sessionResource } from '@/lib/remote/resource';
import type { Operation, OpContext, OpReply } from './registry';

/**
 * Remote-session bearer operations (list, read, terminate).
 *
 * The relay routes under /api/remote/* carry the mirror protocol — frames,
 * input, control — and answer the browser and the runner. These three answer
 * the CLI's RESOURCE vocabulary over the same in-process registry: a session is
 * a read-only typed resource that can be listed, read and terminated, and there
 * is no second store behind them.
 */

const ACCOUNT_REQUIRED = {
  status: 403,
  code: 'account_required',
  fix: 'use a token claimed by your artifactbin account; an unclaimed token owns no sessions',
};
const NOT_FOUND = { status: 404, code: 'not_found', fix: 'list your sessions and use an id from that answer' };
const reply = (body: Record<string, unknown>, status = 200): OpReply => ({ status, body });

/** Every session operation is owner-scoped; an unclaimed token owns nothing. */
function owner(ctx: OpContext): string | OpReply {
  if (!ctx.actor.userId) return reply({ error: 'account_required', hint: ACCOUNT_REQUIRED.fix }, 403);
  return ctx.actor.userId;
}

/** The relay already refuses with the right status; translate, never re-decide. */
function fromRemoteError(error: unknown): OpReply {
  if (error instanceof RemoteError)
    return reply(
      {
        error: error.status === 410 ? 'session_disconnected' : error.status === 404 ? 'not_found' : 'invalid_session',
        message: error.message,
      },
      error.status,
    );
  throw error;
}

const listSessionsOp: Operation = {
  name: 'list_remote_sessions',
  title: 'List remote terminal sessions',
  http: { method: 'GET', path: '/api/sessions' },
  description: 'List the remote terminal sessions this account is running, as editable-resource records: id, name, harness, machine, cwd, status, size and controller. Sessions are relayed in memory and pruned an hour after their last exchange, so there is no history to page through.',
  input: {},
  annotations: { readOnly: true },
  example: { input: {} },
  errors: [ACCOUNT_REQUIRED],
  async run(ctx) {
    const userId = owner(ctx);
    if (typeof userId !== 'string') return userId;
    return reply({ sessions: remoteSessions.list(userId).map(sessionResource) });
  },
};

const getSessionOp: Operation = {
  name: 'get_remote_session',
  title: 'Read one remote terminal session',
  http: { method: 'GET', path: '/api/sessions/{id}' },
  description: 'Read one remote terminal session of yours as a typed resource. Session records are READ-ONLY: there is no rename and no editable setting, so pulling one and pushing it back is refused. A session that was removed answers session_disconnected rather than pretending it was never there.',
  input: { id: z.string() },
  annotations: { readOnly: true },
  example: { input: { id: 'f2b1c0de-0000-4000-8000-000000000000' } },
  errors: [ACCOUNT_REQUIRED, NOT_FOUND, { status: 410, code: 'session_disconnected', fix: 'the session ended; start a new one with afbin remote' }],
  async run(ctx, input) {
    const userId = owner(ctx);
    if (typeof userId !== 'string') return userId;
    try {
      return reply({ session: sessionResource(remoteSessions.read(userId, String(input.id))) });
    } catch (error) {
      return fromRemoteError(error);
    }
  },
};

const terminateSessionOp: Operation = {
  name: 'terminate_remote_session',
  title: 'Terminate a remote terminal session',
  http: { method: 'DELETE', path: '/api/sessions/{id}' },
  description: 'End one remote terminal session of yours: the relay drops it and its runner can no longer exchange output. The local process it mirrors is not killed. Terminating accepts an Idempotency-Key, so a retry after a lost reply answers the first receipt instead of refusing a session that is already gone.',
  input: { id: z.string() },
  annotations: { destructive: true, idempotent: true },
  example: { input: { id: 'f2b1c0de-0000-4000-8000-000000000000' } },
  errors: [ACCOUNT_REQUIRED, NOT_FOUND, { status: 410, code: 'session_disconnected', fix: 'the session already ended; nothing is left to terminate' }],
  async run(ctx, input) {
    const userId = owner(ctx);
    if (typeof userId !== 'string') return userId;
    const id = String(input.id);
    try {
      remoteSessions.remove(userId, id);
    } catch (error) {
      return fromRemoteError(error);
    }
    return reply({ ok: true, id, status: 'terminated' });
  },
};

export const SESSION_OPERATIONS: Operation[] = [listSessionsOp, getSessionOp, terminateSessionOp];
