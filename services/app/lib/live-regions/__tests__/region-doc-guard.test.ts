/**
 * GUARD: every Yjs document is opened through region-doc.ts (openRegionDoc / forkRegionDoc), which obtains the region
 * text before applying any state. A document that applies state bytes first adopts its formats with search markers
 * still on, and a later deletion spreads one line's attributes onto the next (region-doc.ts says why). Every Yjs
 * document in this repository is a region or cell document, so the rule is the simplest enforceable one: nothing but
 * region-doc.ts constructs a Y.Doc (`new Y.Doc`, `new Doc` under any import name) or lets `createDocFromSnapshot`
 * construct one (a call without its third argument). Product code and tests alike: a test replica opened the other
 * way would not be the replica a browser or the server holds.
 *
 * A source scan in the module-graph style: every .ts/.tsx/.mts/.js/.mjs file under services/ that imports yjs is
 * parsed with TypeScript and its constructions listed by file and line. Enrolled in scripts/ci/guard-tests.json.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const SERVICES = path.join(REPO, 'services');
const ALLOWED = 'services/app/lib/live-regions/region-doc.ts';
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite', '.turbo', 'tmp']);
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const YJS = "'yjs'";

/** The places a source constructs a Yjs document itself, as `line:column what`. */
function yjsDocConstructions(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const namespaces = new Set<string>(), docs = new Set<string>(), forks = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'yjs') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === 'Doc') docs.add(element.name.text);
      if (imported === 'createDocFromSnapshot') forks.add(element.name.text);
    }
  }
  const named = (node: ts.Expression, member: string, locals: Set<string>) =>
    (ts.isIdentifier(node) && locals.has(node.text))
    || (ts.isPropertyAccessExpression(node) && node.name.text === member && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text));
  const found: string[] = [];
  const at = (node: ts.Node, what: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${line + 1}:${character + 1} ${what}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && named(node.expression, 'Doc', docs)) at(node, 'new Doc');
    if (ts.isCallExpression(node) && named(node.expression, 'createDocFromSnapshot', forks) && node.arguments.length < 3) at(node, 'createDocFromSnapshot without a target document');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) sources(path.join(dir, entry.name), out); }
    else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path.join(dir, entry.name));
  }
  return out;
}

describe('every Yjs document is opened through region-doc.ts', () => {
  it('finds each way a source can construct a document itself, and nothing else', () => {
    const from = `import * as Y from ${YJS};\nimport { Doc, Doc as Fresh, createDocFromSnapshot as fork, applyUpdate } from ${YJS};\n`;
    expect(yjsDocConstructions('a.ts', `${from}const a = new Y.Doc();\nconst b = new Y.Doc({ gc: false });\nconst c = new Doc;\nconst d = new Fresh();\nY.createDocFromSnapshot(a, s);\nfork(a, s);\n`))
      .toEqual(['3:11 new Doc', '4:11 new Doc', '5:11 new Doc', '6:11 new Doc', '7:1 createDocFromSnapshot without a target document', '8:1 createDocFromSnapshot without a target document']);
    expect(yjsDocConstructions('b.ts', `${from}const a = openRegionDoc(bytes);\nY.createDocFromSnapshot(a, s, openRegionDoc());\nfork(a, s, b);\napplyUpdate(a, bytes);\nclass Doc2 {}\nnew Doc2();\n`)).toEqual([]);
    // Without a yjs import, a `Doc` is someone else's.
    expect(yjsDocConstructions('c.ts', 'class Doc {}\nconst a = new Doc();\n')).toEqual([]);
  });

  it('no source under services/ but region-doc.ts constructs one', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of sources(SERVICES)) {
      const relative = path.relative(REPO, file).split(path.sep).join('/');
      if (relative === ALLOWED) continue;
      const text = readFileSync(file, 'utf8');
      if (!text.includes(YJS) && !text.includes('"yjs"')) continue;
      scanned++;
      for (const place of yjsDocConstructions(file, text)) offenders.push(`${relative}:${place}`);
    }
    expect(scanned, 'the scan reaches the yjs importers').toBeGreaterThan(20);
    expect(offenders, 'open it with openRegionDoc(state, options) or forkRegionDoc(live, snapshot) from lib/live-regions').toEqual([]);
    expect(yjsDocConstructions(ALLOWED, readFileSync(path.join(REPO, ALLOWED), 'utf8')).length, 'region-doc.ts itself constructs documents').toBeGreaterThan(0);
  });
});
