/**
 * THE ONLINE COMMAND IS BOUNDED (scripts/ci/system-debs.mjs): a mirror outage once held apt retrying for 13 minutes per
 * shard (runs 43055731174, 43061010909), and a broken mirror's cause sat under 2,000 lines of dpkg output (run
 * 43846415190). Real child processes and timers, so the full suite runs this file and pr fast's guard runners do not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installOnline, runBounded } from '../ci/system-debs.mjs';

describe('the online install', () => {
  const sh = (script) => ['sh', '-c', script];
  const quiet = { log: () => {} };


  it('stops an attempt past its bound with everything it started, and keeps apt\'s error lines', async () => {
    const started = Date.now();
    const pidFile = path.join(os.tmpdir(), `system-debs-${process.pid}-${started}.pid`);
    // The grandchild stands for the apt a wrapper starts: stopping the wrapper alone would leave it holding dpkg's lock.
    const result = await runBounded('sh', ['-c', `echo 'Err:1 http://azure.archive.ubuntu.com noble InRelease'; sleep 30 & echo $! > ${pidFile}; echo 'E: Failed to fetch x'; wait`], { boundMs: 250, graceMs: 50 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.errors).toEqual(['Err:1 http://azure.archive.ubuntu.com noble InRelease', 'E: Failed to fetch x']);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    rmSync(pidFile);
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let wait = 0; alive() && wait < 40; wait++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive()).toBe(false);
  });

  it('kills an attempt that ignores SIGTERM', async () => {
    const started = Date.now();
    const result = await runBounded('sh', ['-c', "trap '' TERM; sleep 30 & wait; sleep 30"], { boundMs: 100, graceMs: 50 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('retries a failed attempt once and succeeds quietly', async () => {
    const marker = path.join(os.tmpdir(), `system-debs-retry-${process.pid}-${Date.now()}`);
    const lines = [];
    expect(await installOnline(sh(`[ -f ${marker} ] || { touch ${marker}; echo 'E: Unable to fetch'; exit 100; }`), { boundMs: 5_000, log: (line) => lines.push(line) })).toBe(0);
    rmSync(marker);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/attempt 1 of .* exit 100; retrying once/);
  });

  it('gives up after two attempts with one line naming both and apt\'s last errors', async () => {
    const lines = [];
    let recovered = 0;
    const status = await installOnline(sh("echo 'W: Some index files failed to download'; echo 'E: Unable to locate package libwoff1' >&2; sleep 30"), { boundMs: 250, graceMs: 50, recover: () => { recovered++; }, log: (line) => lines.push(line) });
    expect(status).not.toBe(0);
    // dpkg is told to finish what a stopped attempt interrupted before the retry, and only then.
    expect(recovered).toBe(1);
    const summary = lines.filter((line) => line.startsWith('::error::'));
    expect(summary).toHaveLength(1);
    expect(summary[0]).not.toContain('\n');
    expect(summary[0]).toContain('failed twice (1: timed out after 0s, 2: timed out after 0s)');
    expect(summary[0]).toContain('apt said: W: Some index files failed to download | E: Unable to locate package libwoff1');
    expect(await installOnline(sh('exit 3'), { ...quiet, boundMs: 5_000 })).toBe(3);
    expect(await installOnline(['/no/such/command'], { ...quiet, boundMs: 5_000 })).toBe(1);
  });
});

