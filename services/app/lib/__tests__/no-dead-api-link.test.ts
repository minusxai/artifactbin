/**
 * `/api` was the docs endpoint. It moved to `/docs` and now answers 404.
 *
 * Cleaning it up by grep missed one: the home page's empty state and the compose
 * healthcheck were fixed, while `HeaderBar`'s "0 artifacts — point an agent at
 * /api" survived and shipped to production, where it was found by clicking
 * around rather than by any test. Three call sites, three different files, and
 * nothing tying them together.
 *
 * So the rule gets a test instead of a memory. Any link to a path that the app
 * does not route fails here, at the point the link is written.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) out.push(full);
  }
  return out;
}

/** Paths that once existed, are now 404, and must never be linked again. */
const RETIRED_PATHS = ['/api'];

describe('no link points at a retired path', () => {
  it('nothing links to /api (it moved to /docs and answers 404)', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'components'))]) {
      const text = readFileSync(file, 'utf8');
      for (const retired of RETIRED_PATHS) {
        // An href to exactly the retired path — `/api/artifacts` and friends are
        // real routes and must not match.
        const linked = new RegExp(`href=(?:"${retired}"|\\{\`${retired}\`\\}|'${retired}')`).test(text);
        if (linked) offenders.push(`${path.relative(ROOT, file)} → ${retired}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is actually looking at something (the scan cannot silently find nothing)', () => {
    // An empty walk makes the assertion above vacuous, and a renamed or moved
    // directory is exactly how that happens — the guard then passes forever.
    const scanned = [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'components'))];
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned.some((f) => f.endsWith('.tsx'))).toBe(true);
  });
});
