import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Walk actual static imports, not filename spelling or bundle-size guesses.
// Dynamic imports are the intended boundary; package internals are irrelevant.
function staticGraph(entry: string) {
  const root = path.resolve(import.meta.dirname, '../..');
  const seen = new Set<string>();
  function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const name = node.moduleSpecifier.text;
      if (!name.startsWith('.') && !name.startsWith('@/')) continue;
      const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const resolved = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => target + ext).find(p => /\.[tj]sx?$/.test(p) && existsSync(p));
      if (resolved) visit(resolved);
    }
  }
  visit(path.join(root, entry));
  return [...seen].map(file => path.relative(root, file));
}

it('keeps app pages and the artifact runtime outside the initial static graph', () => {
  const graph = staticGraph('web/App.tsx');
  expect(graph).toContain('web/Shell.tsx');
  expect(graph.filter(file => file.startsWith('web/pages/'))).toEqual([]);
  expect(graph).not.toContain('components/ArtifactSurface.tsx');
});

it('does not load the artifact renderer when loading only a profile listing', () => {
  const graph = staticGraph('web/pages/Profile.tsx');
  expect(graph).not.toContain('web/pages/Artifact.tsx');
  expect(graph).not.toContain('components/ArtifactSurface.tsx');
});
