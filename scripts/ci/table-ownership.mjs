/**
 * THE TABLE-OWNERSHIP CHECK (part of `npm run validate`).
 *
 * A table is written by the module that owns it: `artifacts` by lib/artifacts; the identity tables
 * (contracts `IDENTITY_OWNED_TABLES`: users, tokens, handles, groups, memberships, invitations, the hierarchy
 * revision and the group mail outbox) by the identity module, the auth package (`services/auth/src/`), which the
 * app reaches only through its service contract (lib/platform `services().identity`). Every other module that
 * needs one of those writes calls the owner. Reads and joins are anyone's; `FOR UPDATE`/`FOR SHARE` locks are
 * anyone's on `artifacts`, but never on an identity table outside its owner: in a split-role database the app
 * role holds only SELECT there, and a row lock needs UPDATE (42501), so an app decision reads identity rows
 * plainly and never blocks, or is blocked by, an identity write.
 *
 * The check reads every string and template literal of non-test source with the TypeScript parser (so a
 * comment that quotes a statement is not one) and refuses an `UPDATE`, `INSERT INTO` or `DELETE FROM` naming
 * an owned table outside its owner, and a row lock that covers an identity table outside its owner. IMPORTERS
 * lists the code that recreates, erases or rewrites whole rows on purpose: test-user erasure (its artifacts; its
 * identity rows go through the identity service like every other write) and the test fixtures package (anything).
 *
 *   node scripts/ci/table-ownership.mjs [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const ts = createRequire(import.meta.url)('typescript');
const { IDENTITY_OWNED_TABLES } = await tsImport('../../services/contracts/src/identity-module.ts', import.meta.url);

const IDENTITY_OWNER = 'services/auth/src/';
const OWNERS = {
  artifacts: 'services/app/lib/artifacts/',
  ...Object.fromEntries(IDENTITY_OWNED_TABLES.map(table => [table, IDENTITY_OWNER])),
};
/** Owned tables no other module may row-lock either (see the header). */
const LOCK_OWNED = new Set(IDENTITY_OWNED_TABLES);
/** Path prefixes (ending in `/`) or exact files allowed to write any owned table outside the identity set. */
const IMPORTERS = [
  'services/app/lib/operations/testuser-erase.ts',
  'services/test-support/',
];
/** …and the one importer allowed to write the identity tables too: fixtures, which run on a test's own database. */
const IDENTITY_IMPORTERS = ['services/test-support/'];

const NAMES = Object.keys(OWNERS).join('|');
/** An optional schema: `public.`, or an interpolated one (`${schema}.`, which a parsed literal reads as `${}.`). */
const SCHEMA = String.raw`(?:(?:"?public"?|\$\{[^}]*\})\.)?`;
const WRITE = new RegExp(String.raw`(?<!\bFOR\s+)\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:ONLY\s+)?${SCHEMA}"?(${NAMES})"?(?!\w)`, 'gi');
/** A row lock, and the aliases it names (`FOR SHARE OF s, m`), if any. */
const LOCK = /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b(?:\s+OF\s+([\w\s,]+?))?(?=\s*(?:NOWAIT|SKIP\s+LOCKED|\)|;|$|\bFOR\b|\bLIMIT\b))/gi;
const SOURCE_TABLE = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(?:ONLY\s+)?${SCHEMA}"?(\w+)"?(?:\s+(?:AS\s+)?(?!(?:WHERE|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ON|USING|ORDER|GROUP|LIMIT|FOR|UNION|WINDOW|HAVING|AS)\b)(\w+))?`, 'gi');
/** The same patterns over raw text: a file without a match anywhere is not parsed. */
const MENTIONS = new RegExp(WRITE.source, 'i');
const MENTIONS_LOCK = /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b/i;
const LOCK_TABLE = new RegExp(String.raw`\b(${[...LOCK_OWNED].join('|')})\b`, 'i');

/** The identity tables a row lock in one statement covers: every one it reads, or those its `OF` aliases name. */
function lockedIdentityTables(statement) {
  const sources = [...statement.matchAll(SOURCE_TABLE)].map(match => ({ table: match[1].toLowerCase(), alias: (match[2] ?? match[1]).toLowerCase() }));
  const locked = new Set();
  for (const lock of statement.matchAll(LOCK)) {
    const named = lock[1]?.split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
    for (const source of sources) {
      if (!LOCK_OWNED.has(source.table)) continue;
      if (!named || named.includes(source.alias) || named.includes(source.table)) locked.add(source.table);
    }
  }
  return [...locked];
}
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
    if (!SOURCE.test(file) || isTest(file) || allowed(file, IDENTITY_IMPORTERS)) continue;
    const writes = MENTIONS.test(text), locks = !file.startsWith(IDENTITY_OWNER) && MENTIONS_LOCK.test(text) && LOCK_TABLE.test(text);
    if (!writes && !locks) continue;
    for (const literal of literals(file, text)) {
      if (writes) for (const match of literal.text.matchAll(WRITE)) {
        const table = match[2].toLowerCase();
        if (file.startsWith(OWNERS[table]) || (OWNERS[table] !== IDENTITY_OWNER && allowed(file, importers))) continue;
        violations.push(`  ${file}:${literal.line} ${match[1].replace(/\s+/g, ' ').toUpperCase()} ${table} — ${OWNERS[table] === IDENTITY_OWNER ? 'call the identity service (lib/platform services().identity)' : `call a ${OWNERS[table].replace(/^services\/app\//, '').replace(/\/$/, '')} function with this transaction`} instead`);
      }
      if (locks) for (const table of lockedIdentityTables(literal.text))
        violations.push(`  ${file}:${literal.line} row lock on ${table} — identity rows are read, never locked, outside the identity module (an advisory lock serialises an app invariant)`);
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
  } else console.log(`[table ownership] artifacts and the identity tables are written only by their owners, and identity rows are locked only by theirs (${Math.round(performance.now() - started)} ms).`);
}
