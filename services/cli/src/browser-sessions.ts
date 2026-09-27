import { randomUUID } from 'node:crypto';
import type { BrowserSessionResult, ViewerChoice } from '@artifactbin/contracts';
import { CliError } from './errors';
import type { HttpClient } from './http';

/**
 * IDs are printed before polling, so disconnect recovery never requires replaying a script — but only
 * once the server has ACCEPTED the execution: a refused create (capacity, an invalid request) made no
 * session, and an id printed for it is one `status` and `close` can only answer SESSION_NOT_FOUND for.
 */
export async function browserSessionCommand(client: HttpClient, op: string, target: string, options: {
  code?: string; execution?: string; viewer?: ViewerChoice; progress(text: string): void;
}): Promise<BrowserSessionResult> {
  const session_id = target === 'new' ? randomUUID() : target;
  // A session's viewer belongs to its creation; an existing session never changes who it browses as.
  if (options.viewer && target !== 'new') throw new CliError('invalid_viewer', `--as chooses who a NEW session browses as; session ${target} already has the viewer it was created with.`, 'Run afbin sessions script new --as guest --input actions.js for a signed-out session, or --as <testuser-id> to be a second person, or drop --as to continue this one.');
  if (op === 'close' || op === 'status') return client.request('/browser-sessions', 'POST', { op, session_id, ...(options.execution ? { execution_id: options.execution } : {}) }, {}, { readOnly: op === 'status' });
  if (op !== 'script' || options.code === undefined) throw new CliError('invalid_arguments', 'Use sessions script new|session_id --input actions.js, status, or close.');
  if (Buffer.byteLength(options.code) > 65536) throw new CliError('script_too_large', 'Session scripts must fit in 64 KiB.');
  const execution_id = randomUUID();
  const recover = `afbin sessions status ${session_id} --execution ${execution_id}`;
  let result: BrowserSessionResult;
  try {
    result = await client.request<BrowserSessionResult>('/browser-sessions', 'POST', { op, session_id, execution_id, create: target === 'new', code: options.code, ...(options.viewer ? { viewer: options.viewer } : {}) });
  } catch (error) {
    // No answer is not a refusal: the script may be running. Checking is safe; resubmitting is not.
    if (error instanceof CliError && error.code === 'outcome_unknown') options.progress(`Session ${session_id}, execution ${execution_id} may have started. Check before resubmitting: ${recover}\n`);
    throw error;
  }
  if (!result.execution_id) return result;
  options.progress(`Session ${session_id}, execution ${execution_id}. Recover with: ${recover}\n`);
  const deadline = Date.now() + 90000;
  while (result.status === 'queued' || result.status === 'running') {
    if (Date.now() > deadline) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
    result = await client.request<BrowserSessionResult>('/browser-sessions', 'POST', { op: 'status', session_id, execution_id }, {}, { readOnly: true });
  }
  return result;
}
