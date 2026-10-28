/**
 * Internal: check.mjs's two browsers: hosted server browser sessions (one per viewport,
 * receipt-safe status polling and close) and a disposable local Chromium limited to the
 * preview's origin.
 * Used by: check.mjs (re-export), toolbox-check-command.mjs.
 */
import {randomUUID} from 'node:crypto';
import {platform, ToolError} from './toolbox-client.mjs';
import {inspectPage} from './toolbox-check-inspect.mjs';
import {checkScript, checkTarget, summarizeCheck} from './toolbox-check-script.mjs';

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
    capture = false},
  fetcher = fetch
) {
  server = origin(server);
  if (!token && !requester) throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
  async function request(body) {
    if (requester) return requester(body);
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
    if (!response.ok) {
      const code = result.error?.code ?? result.error ?? 'unknown';
      // The server holds a few browser sessions at once; a full server is a known, retryable
      // state, not an unexplained failure.
      if (code === 'SESSION_CAPACITY' || code === 'SESSION_ACTOR_CAPACITY')
        throw new ToolError(
          'browser_busy',
          result.error?.message ?? 'All browser sessions are in use.',
          1,
          'Run checks one at a time; wait a few seconds and retry.'
        );
      throw Error('Browser session refused (HTTP ' + response.status + '): ' + code);
    }
    return result;
  }
  // Each viewport runs in its own fresh session, concurrently: no viewer-local state leaks between
  // viewports and the check takes the slowest viewport's time, not the sum.
  async function inspectViewport(viewport) {
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
      // Creating the session waits up to ~20 s for a free browser slot before reporting
      // browser_busy.
      const submit = async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await request(body);
          } catch (error) {
            if (error?.code !== 'browser_busy' || attempt >= 4) throw error;
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      };
      try {
        run = await submit();
        accepted = true;
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
// Local: a disposable headless Chromium that can only reach the preview's own origin.
export async function checkLocal({target, viewports, steps = '', capture = false}, chromium) {
  const selected = checkTarget(target);
  if (selected.mode !== 'local') throw Error('Local checks require a loopback preview URL.');
  // launch() creates a disposable temporary profile; never attach to an existing browser or
  // userDataDir.
  let browser;
  try {
    browser = await chromium.launch({headless: true});
  } catch {
    throw new ToolError(
      'browser_dependency_missing',
      'Chromium could not start in this harness.',
      1,
      'Install the Playwright Chromium build and its OS dependencies.'
    );
  }
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === selected.origin ? route.continue() : route.abort('blockedbyclient');
    });
    const checks = [];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const viewport of viewports) {
      const page = await context.newPage();
      try {
        checks.push(
          await inspectPage(
            page,
            {target, viewport, capture, compareReload: viewport === viewports[0]},
            steps ? new AsyncFunction('page', 'step', steps) : null
          )
        );
      } finally {
        await page.close();
      }
    }
    return summarizeCheck(checks);
  } finally {
    await browser.close();
  }
}
