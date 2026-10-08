/**
 * The module-graph check (scripts/ci/module-graph.mjs) has to be shown to bite: each rule runs once
 * against a tiny synthetic tree that breaks it, and the real tree must stay clean.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkModuleGraph, moduleOf, recordAllowedCycles, scanModuleGraph } from '../ci/module-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'module-graph.mjs');
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-graph-'));
  temporary.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

const libCycle = {
  'services/app/lib/a/index.ts': "import { b } from '../b';\nexport const a = 1;\n",
  'services/app/lib/b/index.ts': "import type { A } from '@/lib/a/types';\nexport const b = 2;\n",
  'services/app/lib/a/types.ts': 'export type A = 1;\n',
};
const allowList = cycles => ({ cycles });
const ab = { modules: ['lib/a', 'lib/b'], edges: ['lib/a -> lib/b', 'lib/b -> lib/a'] };

describe('module graph', () => {
  it('maps paths to modules', () => {
    expect(moduleOf('services/app/lib/story/x/y.ts')).toBe('lib/story');
    expect(moduleOf('services/app/lib/runner.ts')).toBe('lib/runner');
    expect(moduleOf('services/app/solid/pages/Doc.tsx')).toBe('app/solid');
    expect(moduleOf('services/cli/src/index.ts')).toBe('pkg/cli');
    expect(moduleOf('scripts/lib/x.mjs')).toBe('scripts');
    expect(moduleOf('server.ts')).toBe('server');
  });

  it('counts type-only imports and ignores tests', () => {
    const root = tree({ ...libCycle, 'services/app/lib/b/__tests__/x.test.ts': "import '@/solid/y';\n", 'services/app/lib/b/z.test.ts': "import '@/solid/y';\n" });
    const graph = scanModuleGraph(root);
    expect([...graph.get('lib/b').keys()]).toEqual(['lib/a']);
    expect(graph.get('lib/b').get('lib/a')[0]).toEqual({ file: 'services/app/lib/b/index.ts', specifier: '@/lib/a/types' });
  });

  it('fails a library cycle that the allow-list does not record, naming the edges', () => {
    const { violations } = checkModuleGraph(scanModuleGraph(tree(libCycle)), allowList([]));
    expect(violations.join('\n')).toContain('lib/a -> lib/b');
    expect(violations.join('\n')).toContain('lib/b -> lib/a (services/app/lib/b/index.ts imports @/lib/a/types)');
  });

  it('passes a recorded cycle and fails a new back edge into it', () => {
    expect(checkModuleGraph(scanModuleGraph(tree(libCycle)), allowList([ab])).violations).toEqual([]);
    const grown = scanModuleGraph(tree({ ...libCycle, 'services/app/lib/c/index.ts': "import '../a';\n", 'services/app/lib/b/c.ts': "import '../c';\n" }));
    const { violations } = checkModuleGraph(grown, allowList([ab]));
    expect(violations.join('\n')).toMatch(/lib\/b -> lib\/c[\s\S]*lib\/c -> lib\/a/);
  });

  it('fails a stale allow-list entry so the list only shrinks', () => {
    const { violations } = checkModuleGraph(scanModuleGraph(tree({ 'services/app/lib/a/index.ts': "import '../b';\n", 'services/app/lib/b/index.ts': '' })), allowList([ab]));
    expect(violations.join('\n')).toContain('lib/a -> lib/b');
    expect(violations.join('\n')).toContain('no longer');
  });

  it('fails any cycle through an entry point or the UI, even if allow-listed', () => {
    const root = tree({ ...libCycle, 'services/app/lib/b/ui.ts': "import { Doc } from '@/solid/pages/Doc';\n", 'services/app/solid/pages/Doc.tsx': "import '@/lib/a';\nexport const Doc = 1;\n" });
    const graph = scanModuleGraph(root);
    const allowed = allowList([{ modules: ['app/solid', 'lib/a', 'lib/b'], edges: ['lib/b -> app/solid', 'app/solid -> lib/a', ...ab.edges] }]);
    const { violations } = checkModuleGraph(graph, allowed);
    expect(violations.join('\n')).toContain('app/solid');
    expect(violations.join('\n')).toContain('lib/b -> app/solid (services/app/lib/b/ui.ts imports @/solid/pages/Doc)');
    expect(() => recordAllowedCycles(graph)).toThrow(/app\/solid/);
  });

  it('fails a package that imports anything but contracts, utils or itself', () => {
    const root = tree({
      'services/auth/src/x.ts': "import { c } from '@artifactbin/contracts';\nimport { u } from '@artifactbin/utils/http';\nimport { q } from '@artifactbin/sql';\nimport './y';\n",
      'services/auth/src/y.ts': "export const y = await import('../../app/lib/story/index.ts');\n",
      'services/cli/src/z.ts': "import '@/lib/story';\n",
    });
    const violations = checkModuleGraph(scanModuleGraph(root), allowList([])).violations.join('\n');
    expect(violations).toContain('pkg/auth -> pkg/sql');
    expect(violations).toContain('pkg/auth -> lib/story');
    expect(violations).not.toMatch(/-> pkg\/(contracts|utils)/);
    expect(violations).not.toContain('pkg/cli');
  });

  it('records today\'s library cycles as the allow-list', () => {
    expect(recordAllowedCycles(scanModuleGraph(tree(libCycle))).cycles).toEqual([ab]);
  });

  it('passes on this repository within the time budget', () => {
    const started = Date.now();
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(result.stderr + result.stdout).toMatch(/module graph/);
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
