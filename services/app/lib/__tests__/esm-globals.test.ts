/**
 * `__dirname` IS NOT A THING HERE — and the test runner hides that.
 *
 * This package is ESM ("type": "module"), so `__dirname`/`__filename`/`require`
 * do not exist at runtime. Vitest SHIMS all three, so a module that uses one
 * passes every unit test and then dies with a ReferenceError the first time a
 * person runs it — which is exactly what happened to `npm run eval` (a CLI no
 * test executes) the moment the package declared itself ESM.
 *
 * So the guard is textual, over the code that actually runs in node: the CLIs,
 * the scripts, the server and the libraries they reach. `test/` is exempt along
 * with every `__tests__` — the shim makes all three true there, which is the
 * whole reason this guard has to be textual.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
/** Where node runs this package's own code. `web/` is the browser's. */
const TREES = ['services/app/app', 'services/app/components', 'evals', 'services/app/lib', 'scripts', 'services/app/server', 'services/contracts', 'services/utils', 'services/sql', 'services/browser', 'services/proxy'];
const SKIP = new Set(['node_modules', 'dist', '__tests__', 'data', 'public']);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    // `.cjs` is CommonJS by extension and keeps all three.
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the ESM globals a CommonJS habit reaches for', () => {
  it('nothing outside a test uses __dirname, __filename or a bare require()', () => {
    const offenders = TREES.flatMap((t) => sources(path.join(ROOT, t)))
      .filter((f) => /(?<![\w.])(__dirname|__filename)\b|(?<![\w.])require\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders, 'these die with a ReferenceError outside vitest').toEqual([]);
  });
});
