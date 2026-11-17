/**
 * THE RUN'S PAGE RUNTIME BUILD, SHARED BY ITS WORKERS. A worker that serves a native page needs the runtime build
 * (lib/html-runtime buildHtmlAssets: a dozen esbuild bundles, the Solid chrome and the Tailwind sheet). Compiled by each
 * worker, it was the first such test's cost on every pr fast api runner, three workers bundling at once on four vCPUs:
 * in run 44155040245 a worker's first page-serving test took 5.2-6.0s where the same test, later on a worker, takes
 * 0.3-0.9s (dataflow, http-conformance, export-page-files, admin-document-access), and every api-isolated file paid it
 * again. The global setup (./build-runtime.global.ts) builds it once in the main process, beside the workers' imports,
 * and writes it here whole; a worker's first buildHtmlAssets() waits for it (vitest.setup.ts) and compiles its own only
 * when the main build failed (its marker) or never lands. Same checkout, same build: what the workers would compile.
 *
 * The wait sleeps on node:timers/promises and counts its polls: a test's fake timers replace neither.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { buildHtmlAssets } from '@/lib/html-runtime/server';

declare module 'vitest' {
  interface ProvidedContext {
    /** Set for a project whose workers read the run's shared build (vitest.config.ts: api, api-isolated). */
    htmlAssetsShared?: boolean;
    /** Where the global setup writes that build. */
    htmlAssetsFile?: string;
  }
}

type HtmlRuntimeAssets = Awaited<ReturnType<typeof buildHtmlAssets>>;

const failedMarker = (file: string) => `${file}.failed`;

/** Write the build `assets` resolves to as `file`, whole (a private temporary file renamed into place), or its failure marker. */
export async function writeHtmlAssets(file: string, assets: Promise<HtmlRuntimeAssets>): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.partial`;
  try {
    writeFileSync(temporary, JSON.stringify(await assets));
    renameSync(temporary, file);
  } catch {
    // The workers compile their own: the failure, if it is real, surfaces in the test that needs the build.
    writeFileSync(failedMarker(file), '');
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The build written as `file`, once it lands; undefined when its build failed or nothing lands within `timeoutMs`. */
export async function readHtmlAssets(file: string, { timeoutMs = 120_000, pollMs = 20 } = {}): Promise<HtmlRuntimeAssets | undefined> {
  // Counted in polls, not read off a clock: a test's fake timers stop Date and performance too.
  for (let polls = Math.ceil(timeoutMs / pollMs); ; polls--) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as HtmlRuntimeAssets;
    if (existsSync(failedMarker(file)) || polls <= 0) return undefined;
    await sleep(pollMs);
  }
}

/** Remove the build and its marker. */
export function removeHtmlAssets(file: string): void {
  rmSync(file, { force: true });
  rmSync(failedMarker(file), { force: true });
}
