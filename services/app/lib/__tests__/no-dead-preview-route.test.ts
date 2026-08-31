/**
 * The preview flag has NO endpoint, and nothing may tell anyone it does.
 *
 * `?v=2` lives in the URL and is carried by the app itself (lib/features) —
 * there was briefly a `/preview` route that set a cookie, and when the cookie
 * went, three messages kept pointing at it: two API refusals an agent reads to
 * learn the fix, and `/docs`, which is the protocol. A refusal that names
 * a 404 is worse than one that says nothing, because it sends the reader
 * somewhere instead of nowhere.
 *
 * Same shape and same reason as no-dead-api-link / no-dead-format: the moment
 * a door closes, the sentence that pointed at it becomes a lie, and only a
 * test notices.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PREVIEW_PARAM, PREVIEW_VERSION } from '@/lib/features';

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', 'data', 'public', 'dist']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Dot-directories are never sources — and one of them, `.claude/worktrees`,
    // holds whole checkouts of this repo, which a scan that entered them would
    // report as offenders in the copy of this very file. The other guards here
    // skip them the same way.
    if (SKIP.has(entry) || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs|md)$/.test(entry) && full !== __filename) out.push(full);
  }
  return out;
}

describe('the preview flag has no route to point at', () => {
  it('nothing anywhere links to /preview', () => {
    const offenders = sourceFiles(ROOT)
      .filter((f) => /['"`\s(]\/preview\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders, 'these still send a reader to a route that does not exist').toEqual([]);
  });

  it('the app serves nothing at /preview', () => {
    expect(() => statSync(path.join(ROOT, 'app/preview'))).toThrow();
  });

  it('the refusals name the mechanism that DOES exist — the query parameter', () => {
    // DERIVED, not a hand-listed pair: a refusal that moves to another module
    // (the wire model did exactly that) would otherwise leave this guard
    // checking a file that no longer refuses anything — green, and blind.
    const refusers = sourceFiles(ROOT)
      .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'))
      .filter((f) => readFileSync(f, 'utf8').includes("'preview_feature'"));
    expect(refusers.length, 'no refusal found at all — this guard would pass vacuously').toBeGreaterThan(0);
    for (const file of refusers) {
      const refusal = /preview_feature[\s\S]{0,400}/.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
      expect(refusal, `${path.relative(ROOT, file)} must tell the caller how to turn the preview on`)
        .toContain(`?${PREVIEW_PARAM}=${PREVIEW_VERSION}`);
    }
  });

  it('the docs teach the same thing (it is the protocol an agent reads)', async () => {
    const { renderDoc } = await import('@/lib/skills');
    const doc = renderDoc('artifact-bin/references/publishing-datasets.md', 'https://artifactbin.dev');
    expect(doc).toContain(`?${PREVIEW_PARAM}=${PREVIEW_VERSION}`);
    expect(doc).not.toContain('/preview');
  });
});
