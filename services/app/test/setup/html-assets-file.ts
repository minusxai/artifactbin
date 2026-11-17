/**
 * THE RUN'S PAGE RUNTIME BUILD, SHARED BY ITS WORKERS. A worker that serves a native page needs the runtime build
 * (lib/html-runtime buildHtmlAssets: a dozen esbuild bundles, the Solid chrome and the Tailwind sheet). Compiled by each
 * worker, it was the first such test's cost on every pr fast api runner, three workers bundling at once on four vCPUs:
 * in run 44155040245 a worker's first page-serving test took 5.2-6.0s where the same test, later on a worker, takes
 * 0.3-0.9s (dataflow, http-conformance, export-page-files, admin-document-access), and every api-isolated file paid it
 * again. Now the first worker to need it compiles it, alone, and keeps it in one file for the run; every other worker
 * reads that file (waiting while it is written) instead of compiling. Same checkout, same build.
 *
 * The global setup (./build-runtime.global.ts) names the file and removes it after the run; vitest.setup.ts hands each
 * file's runtime this supply. Whoever creates the lock beside the file compiles; a failed compile leaves a marker, and a
 * reader that sees it, or waits past the timeout, compiles its own. The wait sleeps on node:timers/promises and counts
 * its polls: a test's fake timers replace neither.
 */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HtmlAssetsSupply } from '@/lib/html-runtime/server';

declare module 'vitest' {
  interface ProvidedContext {
    /** Set for a project whose workers share the run's build (vitest.config.ts: api, api-isolated). */
    htmlAssetsShared?: boolean;
    /** Where the run keeps that build. */
    htmlAssetsFile?: string;
  }
}

type HtmlRuntimeAssets = Parameters<HtmlAssetsSupply['built']>[0];

const lockFile = (file: string) => `${file}.lock`;
const failedMarker = (file: string) => `${file}.failed`;

/** The build kept as `file`, once it lands; undefined when its compile failed or nothing lands within `timeoutMs`. */
export async function readHtmlAssets(file: string, { timeoutMs = 60_000, pollMs = 20 } = {}): Promise<HtmlRuntimeAssets | undefined> {
  // Counted in polls, not read off a clock: a test's fake timers stop Date and performance too.
  for (let polls = Math.ceil(timeoutMs / pollMs); ; polls--) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as HtmlRuntimeAssets;
    if (existsSync(failedMarker(file)) || polls <= 0) return undefined;
    await sleep(pollMs);
  }
}

/** The supply one runtime instance reads the run's build through: the first to ask compiles and keeps it, the rest read it. */
export function htmlAssetsSupply(file: string, waiting?: { timeoutMs?: number; pollMs?: number }): HtmlAssetsSupply {
  let compiles = false;
  return {
    async read() {
      if (existsSync(file)) return readHtmlAssets(file);
      mkdirSync(path.dirname(file), { recursive: true });
      try {
        closeSync(openSync(lockFile(file), 'wx'));
        compiles = true;
        return undefined;
      } catch {
        return readHtmlAssets(file, waiting);
      }
    },
    built(assets) {
      if (!compiles) return;
      // Written whole: a private temporary file renamed into place.
      const temporary = `${file}.${process.pid}.partial`;
      try {
        writeFileSync(temporary, JSON.stringify(assets));
        renameSync(temporary, file);
      } catch {
        writeFileSync(failedMarker(file), '');
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    failed() {
      if (compiles) writeFileSync(failedMarker(file), '');
    },
  };
}

/** Remove the build, its lock and its marker. */
export function removeHtmlAssets(file: string): void {
  for (const name of [file, lockFile(file), failedMarker(file)]) rmSync(name, { force: true });
}
