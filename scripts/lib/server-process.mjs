/**
 * A SERVER BOOTED AS A CHILD PROCESS, for whoever drives one from outside: the gate runner's production servers
 * (scripts/gates.mjs) and the dev-app test's development server (services/app/__tests__/dev-app.test.ts). The two
 * mechanics they shared, written once: wait until the child serves, failing fast when it exits first, and stop it
 * — ask, wait, insist.
 *
 * Plain Node on purpose: the gate runner runs without a TypeScript loader, and a Vitest test imports an .mjs like
 * any module (services/test-support is TypeScript, so it cannot be this module's home). The dev runner
 * (scripts/lib/dev-runner.mjs) hands its terminal to `tsx watch` and exits with it, so it neither waits nor stops;
 * the CLI harness (services/app/__tests__/cli-harness.ts) binds no socket at all.
 */

const alive = (child) => child.exitCode === null && child.signalCode === null;

/**
 * Poll `url` until `ready(response)` holds. Throws `exited(code)` as soon as the child has exited and `never()` once
 * `timeoutMs` passes; a request that throws or outlives `requestTimeoutMs` is "not up yet".
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ url: string, ready?: (response: Response) => boolean, timeoutMs: number, intervalMs: number,
 *   requestTimeoutMs?: number, exited: (code: number | null) => string, never: () => string }} options
 */
export async function waitUntilServing(child, { url, ready = (response) => response.ok, timeoutMs, intervalMs, requestTimeoutMs, exited, never }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(exited(child.exitCode));
    try {
      if (ready(await fetch(url, requestTimeoutMs ? { signal: AbortSignal.timeout(requestTimeoutMs) } : {}))) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(never());
}

/**
 * SIGTERM, up to `graceMs` for the child to go, then SIGKILL and wait for it: a production-mode app takes its time
 * over a graceful close, and a finished caller has nothing left to be graceful about.
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ graceMs: number }} options
 */
export async function stopServer(child, { graceMs }) {
  if (!child || !alive(child)) return;
  const exited = new Promise((resolve) => child.once('exit', () => resolve()));
  try { child.kill('SIGTERM'); } catch { /* gone */ }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, graceMs))]);
  if (alive(child)) {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    await exited;
  }
}
