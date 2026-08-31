/**
 * ONE schema render per process. `scripts/render-schema.mjs --json` is a subprocess (node + the schema generator);
 * two suites used to spawn it per file. The render is a pure function of the checked-out sources, so within one test
 * process it is rendered once and shared; a fresh process (the next `vitest run`) renders again — nothing is cached
 * across runs, so a generator change can never be hidden by a stale copy.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface RenderedSchema {
  schema: string;
  roles: string;
  grants: string;
  tables: Record<string, 'app' | 'proxy'>;
}

/** How many subprocesses this process has spawned — the pin reads it. */
export const renders = { count: 0 };

const ROOT = path.resolve(import.meta.dirname, '../../..');
let cached: RenderedSchema | undefined;

export function renderedSchema(): RenderedSchema {
  if (!cached) {
    renders.count++;
    cached = JSON.parse(execFileSync('node', ['scripts/render-schema.mjs', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })) as RenderedSchema;
  }
  return cached;
}
