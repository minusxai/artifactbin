/**
 * THE TABLE-OWNERSHIP CHECK (part of `npm run validate`).
 *
 * A table is written by the module that owns it: `artifacts` by lib/artifacts, `users` and `tokens` by
 * lib/accounts. Every other module that needs one of those writes calls the owner's function, passing its
 * own transaction. Reads, joins and `FOR UPDATE`/`FOR SHARE` locks are anyone's.
 *
 * The check reads every string and template literal of non-test source with the TypeScript parser (so a
 * comment that quotes a statement is not one) and refuses an `UPDATE`, `INSERT INTO` or `DELETE FROM` naming
 * an owned table outside its owner. IMPORTERS lists the code that recreates or erases whole rows on purpose:
 * the native importers, the disposable migration provider that seeds them, test-user erasure and the test
 * fixtures package.
 *
 *   node scripts/ci/table-ownership.mjs [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

const OWNERS = {
  artifacts: 'services/app/lib/artifacts/',
  users: 'services/app/lib/accounts/',
  tokens: 'services/app/lib/accounts/',
};
/** Path prefixes (ending in `/`) or exact files allowed to write any owned table. */
const IMPORTERS = [
  'services/app/lib/native-history-import/',
  'services/app/lib/native-identity-import/',
  'services/app/lib/native-ancillary-folders/',
  'services/app/lib/operations/testuser-erase.ts',
  'services/test-support/',
  // Seeds the disposable database the native importers are rehearsed against.
  'scripts/lib/native-migration-disposable-provider.ts',
];

const WRITE = new RegExp(String.raw`(?<!\bFOR\s+)\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:"?public"?\.)?"?(${Object.keys(OWNERS).join('|')})"?(?!\w)`, 'gi');
/** The same pattern over raw text: a file without a match anywhere is not parsed. */
const MENTIONS = new RegExp(WRITE.source, 'i');
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const isTest = file => /\.test\.\w+$/.test(file) || /(^|\/)__tests__\//.test(file);
const allowed = (file, prefixes) => prefixes.some(prefix => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);

/** The text of every string and template literal in a source file; a substitution reads as `${}`. */
function literals(file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ text: node.text, pos: node.getStart(source) });
    else if (ts.isTemplateExpression(node)) out.push({ text: [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join('${}'), pos: node.getStart(source) });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.map(literal => ({ ...literal, line: source.getLineAndCharacterOfPosition(literal.pos).line + 1 }));
}

/** Policy: `files` ({ path, text }, repository-relative) → one readable line per refused write. */
export function tableOwnershipViolations(files, importers = IMPORTERS) {
  const violations = [];
  for (const { path: file, text } of files) {
    if (!SOURCE.test(file) || isTest(file) || allowed(file, importers) || !MENTIONS.test(text)) continue;
    for (const literal of literals(file, text)) {
      for (const match of literal.text.matchAll(WRITE)) {
        const table = match[2].toLowerCase();
        if (file.startsWith(OWNERS[table])) continue;
        violations.push(`  ${file}:${literal.line} ${match[1].replace(/\s+/g, ' ').toUpperCase()} ${table} — call a ${OWNERS[table].replace(/^services\/app\//, '').replace(/\/$/, '')} function with this transaction instead`);
      }
    }
  }
  return violations;
}

/** Every tracked or new, non-ignored source file under services/, scripts/ and server.ts. */
function scanSources(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'services', 'scripts', 'server.ts'], { cwd: root, maxBuffer: 1 << 28 }).toString();
  return out.split('\n').filter(file => SOURCE.test(file) && !/(^|\/)(node_modules|dist|generated)\//.test(file) && !isTest(file)
    && fs.existsSync(path.join(root, file))).map(file => ({ path: file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = path.resolve(at < 0 ? '.' : args[at + 1]);
  const started = performance.now();
  const violations = tableOwnershipViolations(scanSources(root));
  if (violations.length) {
    console.error(`[table ownership] ${violations.length} write(s) to a table outside its owning module:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`[table ownership] artifacts, users and tokens are written only by their owners (${Math.round(performance.now() - started)} ms).`);
}
