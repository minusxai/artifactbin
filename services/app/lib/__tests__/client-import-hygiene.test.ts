/**
 * A `'use client'` file must not import a VALUE from a server module.
 *
 * Types erase; values do not. The share menu once imported one constant from
 * lib/artifacts and Turbopack answered by pulling lib/db and lib/analytics
 * (`next/headers`) into the client bundle — a build error the unit suite
 * cannot see, because vitest resolves the import happily. This reads the
 * sources and refuses the shape itself: from these modules a client file may
 * import `type`s and nothing else. The pure homes (lib/share-roles,
 * lib/story-runtime/contract, …) exist precisely so it never has to.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_MODULES = ['@/lib/artifacts', '@/lib/db', '@/lib/users', '@/lib/auth', '@/lib/viewer', '@/lib/analytics', '@/lib/tokens'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const isClientFile = (src: string) => /^\s*(['"])use client\1/m.test(src);
/** Every import of `mod` that is not a pure `import type`. */
const valueImportsOf = (src: string, mod: string) =>
  [...src.matchAll(/^import\s+(?!type\s)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)]
    .filter((m) => m[2] === mod)
    // `import { type A, type B } from` is a value import syntactically but erases too.
    .filter((m) => !m[1].replace(/[{}\s]/g, '').split(',').filter(Boolean).every((spec) => spec.startsWith('type')));

describe('client-import hygiene', () => {
  const root = process.cwd();
  const clientFiles = [...walk(join(root, 'components')), ...walk(join(root, 'lib')), ...walk(join(root, 'app'))]
    .filter((p) => isClientFile(readFileSync(p, 'utf8')));

  it('finds the client components it is meant to police', () => {
    expect(clientFiles.some((p) => p.endsWith('components/ShareLink.tsx'))).toBe(true);
  });

  it("no 'use client' file imports a value from a server module", () => {
    const offenders: string[] = [];
    for (const p of clientFiles) {
      const src = readFileSync(p, 'utf8');
      for (const mod of SERVER_MODULES) {
        if (valueImportsOf(src, mod).length) offenders.push(`${p.slice(root.length + 1)} ← ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
