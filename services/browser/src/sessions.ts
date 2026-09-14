import { randomUUID } from 'node:crypto';
import type { Actor, BrowserSessionRequest, BrowserSessionResult, BrowserSessions } from '@artifactbin/contracts';
import { SESSION_LIMITS } from '@artifactbin/contracts';

export interface SessionWorker {
  run(code: string): Promise<Pick<BrowserSessionResult, 'result' | 'pages' | 'attachments' | 'error'>>;
  close(): Promise<void>;
  onClose?(listener: () => void): void;
}
export type SessionWorkerFactory = (actor: Actor) => Promise<SessionWorker>;
interface Session {
  owner: string;
  worker: Promise<SessionWorker>;
  queue: Promise<void>;
  executions: Map<string, { code: string; result: BrowserSessionResult }>;
  pages: BrowserSessionResult['pages'];
  status: 'idle' | 'lost' | 'closed';
  touched: number;
}
const ownerOf = (actor: Actor) => actor.userId ? `user:${actor.userId}` : actor.tokenId ? `token:${actor.tokenId}` : null;
const idValid = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);

/** Owns leases, execution receipts, and serialization; workers own live browser objects. */
export function createBrowserSessions(factory: SessionWorkerFactory): BrowserSessions {
  const sessions = new Map<string, Session>();
  const empty = (id: string, code: string, message: string): BrowserSessionResult => ({ session_id: id, status: 'failed', pages: [], attachments: [], error: { code, message } });
  const close = async (session: Session, status: 'lost' | 'closed') => {
    session.status = status;
    for (const execution of session.executions.values()) {
      if (execution.result.status === 'running' || execution.result.status === 'queued') Object.assign(execution.result, {
        status, error: { code: status === 'lost' ? 'SESSION_LOST' : 'SESSION_CLOSED', message: 'Browser session ended; effects already committed are not rolled back' },
      });
    }
    await session.worker.then(worker => worker.close(), () => {});
  };
  const sweep = setInterval(() => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.touched <= SESSION_LIMITS.idleMs) continue;
      void close(session, 'lost'); sessions.delete(id);
    }
  }, 30000);
  sweep.unref();
  return {
    async request(input: BrowserSessionRequest) {
      const owner = ownerOf(input.actor);
      if (!owner) return empty(input.session_id, 'AUTH_REQUIRED', 'Authenticate before using browser sessions');
      if (!idValid(input.session_id)) return empty('', 'INVALID_REQUEST', 'Invalid session ID');
      let session = sessions.get(input.session_id);
      if (input.op === 'script') {
        if (!idValid(input.execution_id) || typeof input.code !== 'string' || Buffer.byteLength(input.code) > SESSION_LIMITS.scriptBytes) return empty(input.session_id, 'INVALID_REQUEST', 'Invalid execution ID or script exceeds 64 KiB');
        if (!session && input.create) {
          if (sessions.size >= SESSION_LIMITS.sessions) {
            const ended = [...sessions].find(([, value]) => value.status !== 'idle');
            if (ended) sessions.delete(ended[0]);
          }
          if ([...sessions.values()].filter(s => s.status === 'idle').length >= SESSION_LIMITS.sessions) return empty(input.session_id, 'CAPACITY', 'Browser session capacity reached; close an existing session');
          const worker = Promise.resolve().then(() => factory(input.actor));
          // Failure is recorded on the execution, including failures before the first script.
          void worker.catch(() => {});
          session = { owner, worker, queue: Promise.resolve(), executions: new Map(), pages: [], status: 'idle', touched: Date.now() };
          sessions.set(input.session_id, session);
          const created = session;
          void worker.then(value => value.onClose?.(() => { if (created.status === 'idle') void close(created, 'lost'); }), () => {});
        }
      }
      if (!session || session.owner !== owner) return empty(input.session_id, 'SESSION_NOT_FOUND', 'Session is unavailable to this credential');
      session.touched = Date.now();
      if (input.op === 'close') {
        await close(session, 'closed');
        return { session_id: input.session_id, status: 'closed', pages: session.pages, attachments: [] };
      }
      if (input.op === 'status') {
        if (input.execution_id) return structuredClone(session.executions.get(input.execution_id)?.result ?? empty(input.session_id, 'EXECUTION_NOT_FOUND', 'Execution receipt is unavailable'));
        const latest = [...session.executions.values()].at(-1)?.result;
        if (latest) return structuredClone({ ...latest, ...(session.status !== 'idle' ? { status: session.status } : {}) });
        return { session_id: input.session_id, status: session.status, pages: structuredClone(session.pages), attachments: [] };
      }
      const previous = session.executions.get(input.execution_id);
      if (previous) return previous.code === input.code ? structuredClone(previous.result) : empty(input.session_id, 'EXECUTION_CONFLICT', 'An execution ID cannot be reused for different code');
      if (session.status !== 'idle') return empty(input.session_id, 'SESSION_LOST', 'Create a new session explicitly; this browser cannot be resumed');
      if (session.executions.size >= SESSION_LIMITS.executions) return empty(input.session_id, 'EXECUTION_LIMIT', 'Session execution limit reached; close it and create a new session');
      const result: BrowserSessionResult = { session_id: input.session_id, execution_id: input.execution_id || randomUUID(), status: 'queued', pages: session.pages, attachments: [] };
      session.executions.set(input.execution_id, { code: input.code, result });
      const current = session;
      current.queue = current.queue.then(async () => {
        if (current.status !== 'idle') return;
        result.status = 'running';
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const output = await Promise.race([
            current.worker.then(worker => worker.run(input.code)),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Script deadline exceeded')), SESSION_LIMITS.scriptMs); }),
          ]);
          if (current.status !== 'idle') return;
          if (Buffer.byteLength(JSON.stringify(output)) > SESSION_LIMITS.outputBytes) throw new Error('Session output limit exceeded');
          Object.assign(result, output, { status: output.error ? 'failed' : 'completed' });
          current.pages = output.pages;
        } catch (error) {
          result.status = 'lost'; result.error = { code: 'SESSION_LOST', message: String((error as Error).message).slice(0, 500) };
          await close(current, 'lost');
        } finally { clearTimeout(timer); current.touched = Date.now(); }
      });
      return structuredClone(result);
    },
    async close() { clearInterval(sweep); await Promise.all([...sessions.values()].map(session => close(session, 'closed'))); sessions.clear(); },
  };
}
