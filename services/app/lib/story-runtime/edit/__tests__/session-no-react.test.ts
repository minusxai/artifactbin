/**
 * `edit/session.tsx` is dynamically imported on the compiled-DOM path
 * (components/IslandStory) with no React tree around it. The React render
 * seam (`decorate`/`decorateChildren`) lives in a separate module
 * (./session-decorate), loaded only by `EditorStoryRuntime`, which still
 * renders through React's `StoryRuntimeApp`. This walks session.tsx's own
 * static import graph (skipping `import type`, which is erased, and dynamic
 * `import()`, its own chunk) and fails if it reaches `react` — see
 * lib/__tests__/reader-bundle-hygiene.test.ts for the same technique against
 * the reader entries.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ENTRY = path.join(ROOT, 'lib/story-runtime/edit/session.ts' + 'x');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function staticImports(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  const fromRe = /(?:^|\n)\s*(import|export)\s+([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = fromRe.exec(code); m; m = fromRe.exec(code)) {
    if (!/^type\b/.test(m[2].trim())) specs.push(m[3]);
  }
  const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (let m = bareRe.exec(code); m; m = bareRe.exec(code)) specs.push(m[1]);
  return specs;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

function resolveSpec(spec: string, fromFile: string): { file?: string; pkg?: string } {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else {
    const parts = spec.split('/');
    return { pkg: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
  }
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (isFile(candidate)) return { file: candidate };
  }
  return {};
}

function reachesPackage(entry: string, pkg: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  const parent = new Map<string, string>();
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      const r = resolveSpec(spec, file);
      if (r.pkg === pkg) {
        const chain = [file];
        for (let p: string | undefined = file; (p = parent.get(p));) chain.unshift(p);
        return chain.map((f) => path.relative(ROOT, f));
      }
      if (r.file && !seen.has(r.file)) {
        seen.add(r.file);
        parent.set(r.file, file);
        queue.push(r.file);
      }
    }
  }
  return null;
}

describe('edit/session.tsx stays React-free', () => {
  it('reaches no react package through static imports', () => {
    const chain = reachesPackage(ENTRY, 'react');
    expect(chain).toBeNull();
  });

  it('reaches its React render seam only through session-decorate, never itself', () => {
    const src = readFileSync(ENTRY, 'utf8');
    expect(staticImports(src).some((s) => s.includes('session-decorate'))).toBe(false);
  });
});
