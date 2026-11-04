/**
 * Internal: check.mjs's hosted browser: server browser sessions, one per viewport, with
 * receipt-safe status polling and close; a busy or refusing browser is retried here (bounded).
 * Used by: check.mjs (re-export), toolbox-check-command.mjs.
 */
import {randomUUID} from 'node:crypto';
import {platform, ToolError} from './toolbox-client.mjs';
import {checkScript, summarizeCheck} from './toolbox-check-script.mjs';

function origin(value) {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('Select a server origin.');
  return url.origin;
}
/** One session, one execution per viewport, receipt-safe status polling and close. */
/** @param {any} options */
// Hosted: one server browser session per viewport, all concurrent, each polled to completion and
// closed.
export async function checkHosted(
  {target, viewports, steps = '', viewer, server, token = undefined, requester = undefined,
    capture = false, busyDelayMs = 5000},
  fetcher = fetch
) {
  server = origin(server);
  if (!token && !requester) throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
  // The server holds a few browser sessions at once; a full server is a known, transient state,
  // not an unexplained failure. It refuses a create with a 200 receipt naming no session (or an
  // error status carrying the same code), through either transport. The check waits it out itself.
  const capacity = (error = {}) =>
    ['SESSION_CAPACITY', 'SESSION_ACTOR_CAPACITY'].includes(error.code) &&
    new ToolError('browser_busy', (error.message ?? 'All browser sessions are in use.') +
      ' The check waited for a free browser for about 40 s.', 1,
      'Let your other checks finish first, then run this check once more.');
  const pause = () => new Promise(resolve => setTimeout(resolve, busyDelayMs));
  async function request(body) {
    if (requester) {
      const result = await requester(body).catch(error => { throw capacity(error) || error; });
      if (capacity(result?.error)) throw capacity(result.error);
      return result;
    }
    // Only a status read is repeated through a restart (shared policy, lib/http/retry); a script
    // submission is never replayed — its lost response is recovered by observing the same receipt
    // below.
    const send = () =>
      fetcher(server + '/api/browser-sessions', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Origin: server
        },
        body: JSON.stringify(body)
      });
    const response =
      body.op === 'status'
        ? (await (await platform()).retryFetch(send, {method: 'POST', safeToRepeat: true})).response
        : await send();
    const result = await response.json();
    const code = result.error?.code ?? result.error ?? 'unknown';
    if (capacity(result.error)) throw capacity(result.error);
    if (!response.ok)
      throw Error('Browser session refused (HTTP ' + response.status + '): ' + code);
    return result;
  }
  // Each viewport runs in its own fresh session, concurrently: no viewer-local state leaks between
  // viewports and the check takes the slowest viewport's time, not the sum.
  // A browser that is busy or refused to start never ran the steps: that viewport starts over in a
  // new session (bounded); anything after an accepted submission is reported, never replayed.
  // Status reads repeat through a transient network failure in the transport (safe to repeat).
  async function inspectViewport(viewport) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await inspectOnce(viewport);
      } catch (error) {
        const limit = {browser_busy: 8, browser_session_failed: 2}[error?.code] ?? 0;
        if (attempt >= limit) throw error;
        await pause();
      }
    }
  }
  async function inspectOnce(viewport) {
    const session_id = randomUUID(),
      execution_id = randomUUID(),
      out = [];
    let accepted = false;
    try {
      const body = {
        op: 'script',
        session_id,
        execution_id,
        create: true,
        code: checkScript({
          target,
          viewports: [viewport],
          steps,
          capture,
          compareReload: viewport === viewports[0]
        }),
        ...(viewer ? {viewer} : {})
      };
      let run;
      try {
        run = await request(body);
        // Only a session the server created is closed later.
        accepted = run.session_id === session_id;
      } catch (error) {
        if (error?.code === 'browser_busy') throw error;
        // A lost submission response may still have executed. Observe the same receipt; never
        // replay actions.
        try {
          run = await request({op: 'status', session_id, execution_id});
          accepted = run.session_id === session_id;
        } catch {
          throw error;
        }
      }
      if (run.session_id !== session_id && run.status === 'failed' && run.error?.code)
        throw new ToolError('browser_session_failed', `The server browser refused the check (${
          run.error.code}): ${run.error.message ?? 'no detail'}`, 1,
          'The check tried three times; this is the server, not your page: tell the user the ' +
          'browser check could not run.');
      if (run.session_id !== session_id || run.execution_id !== execution_id)
        throw Error('Mismatched browser receipt.');
      for (
        const deadline = Date.now() + 25000;
        ['queued', 'running'].includes(run.status) && Date.now() < deadline;
      ) {
        await new Promise(resolve => setTimeout(resolve, 250));
        run = await request({op: 'status', session_id, execution_id});
      }
      out.push(
        run.status === 'completed'
          ? run.result
          : {viewport, error: run.error ?? run.status, session_id, execution_id, pages: run.pages}
      );
    } finally {
      if (accepted)
        try {
          await request({op: 'close', session_id});
        } catch (error) {
          out.push({error: 'Session cleanup failed: ' + error.message});
        }
    }
    return out;
  }
  const settled = await Promise.allSettled(viewports.map(inspectViewport));
  const busy = settled.find(result => result.status === 'rejected');
  if (busy) throw busy.reason;
  return summarizeCheck(settled.flatMap(result => result.value));
}
