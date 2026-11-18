/**
 * THE scratch directory a test writes files into: created under the OS temp directory (or `parent`) and removed by the
 * runner when the test (or the hook that made it) is done, so a test body never carries its own try/finally `rm`.
 *
 * `cleanup` is the runner's hook, because this package imports no runner: vitest's `onTestFinished` inside a test or
 * `beforeEach`, `afterAll` at a file's or a `describe`'s top level (never inside `beforeAll`, where it never runs).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Cleanup = (remove: () => Promise<void>) => unknown;

/** A new empty directory named `<prefix>XXXXXX`, removed (recursively) through `cleanup`. */
export async function tempDir(prefix: string, cleanup: Cleanup, parent = tmpdir()): Promise<string> {
  const dir = await mkdtemp(path.join(parent, prefix));
  cleanup(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** `tempDir` for synchronous set-up. */
export function tempDirSync(prefix: string, cleanup: Cleanup, parent = tmpdir()): string {
  const dir = mkdtempSync(path.join(parent, prefix));
  cleanup(async () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
