/**
 * THE TABLE-OWNERSHIP CHECK (part of npm run validate).
 *
 * Each app table has a product write owner or is retained without a product writer.
 * Identity tables belong to the auth package and the app writes through services().identity.
 * Reads and joins are shared. Identity row locks stay inside auth because the app role has
 * SELECT only there, and an app decision must not wait for or block an identity write.
 *
 * The TypeScript parser extracts literal SQL from non-test sources. Runtime-built table
 * names, generated migrations, cascades and database grants are outside this static check.
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

const { TABLES } = await tsImport('../../services/app/lib/platform/schema.ts', import.meta.url);
const IDENTITY_OWNER = 'services/auth/src/';
const APP_LIB = 'services/app/lib/';

/** Map by write boundary. Each declared app table must occur exactly once. */
const APP_OWNERS = {
  accounts: ['codes', 'pages_sessions'],
  analytics: ['canonical_view_totals', 'canonical_view_visitors'],
  annotations: ['annotations', 'comment_images', 'comment_reactions'],
  'artifact-access': ['artifact_shares'],
  artifacts: [
    'artifact_creation_operations', 'artifact_edits', 'artifact_group_shares', 'artifact_id_registry',
    'artifact_source_ids', 'artifact_versions', 'artifacts', 'dataset_connections', 'dataset_policy_audit',
    'id_reservation_batches', 'legacy_page_migrations', 'mutation_receipts', 'ownership_transfers',
    'prepared_pages', 'region_snapshots', 'region_states', 'region_updates',
  ],
  datasets: ['dataset_usage'],
  deployment: ['deployment_members', 'deployment_state'],
  'document-data': ['dataset_images'],
  export: ['export_image_cache', 'export_images'],
  groups: ['group_audit', 'group_links', 'group_quotas'],
  notifications: ['member_notifications', 'user_blocks'],
  'object-store': ['object_writes'],
  platform: ['event_outbox', 'identity_settings'],
  publish: ['web_assets'],
  'query-approvals': ['page_query_approvals'],
  social: ['relations'],
  trust: ['document_trust', 'group_trust'],
  'user-pages': ['user_site_roots'],
};
/** Still declared for existing installations; no in-tree serving writer. */
const RETAINED_TABLES = ['analytics_events', 'artifact_view_totals', 'data_snapshots', 'mermaid_harvests', 'mermaid_images', 'native_identity_imports'];
const appOwners = [
  ...Object.entries(APP_OWNERS).flatMap(([module, tables]) => tables.map(table => [table, APP_LIB + module + '/'])),
  ...RETAINED_TABLES.map(table => [table, null]),
];
const OWNERS = new Map([...appOwners, ...IDENTITY_OWNED_TABLES.map(table => [table, IDENTITY_OWNER])]);
/** Owned tables no other module may row-lock either (see the header). */
const LOCK_OWNED = new Set(IDENTITY_OWNED_TABLES);
const FIXTURES = 'services/test-support/';

/** Exact file, operation and table. Keep the caller's transaction and its existing SQL order. */
const EXCEPTIONS = {
  // Hard erasure sweeps app tables by schema-derived artifact/account keys as one retryable transaction.
  // These are its literal deletes for rows requiring an extra predicate or a specific position in the sweep.
  'services/app/lib/operations/testuser-erase.ts': {
    'DELETE FROM': ['annotations', 'artifacts', 'comment_reactions', 'member_notifications', 'relations', 'user_blocks'],
  },
  // Membership already holds artifact and participant locks. Dismiss the matching pending invite
  // before changing the relation and projecting the event to the inbox, in that same transaction.
  'services/app/lib/artifacts/membership/membership.ts': { UPDATE: ['member_notifications'] },
  // The boot connection migrates legacy follows/likes before getDb() can return a serving connection.
  'services/app/lib/platform/db.ts': { UPDATE: ['relations'] },
  // Operator transactions span the auth and app schemas. The audit row commits with the new root or
  // with the reviewed seat changes; enrollment uses the audit record to make replay idempotent.
  'services/auth/scripts/prepare-company-root.ts': { 'INSERT INTO': ['group_audit'] },
  'services/auth/scripts/enroll-company-root.ts': { 'INSERT INTO': ['group_audit'] },
};

const NAMES = [...OWNERS.keys()].join('|');
/** A schema qualifier may be literal or an interpolation. */
const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z_][\w$]*)`;
const SCHEMA = String.raw`(?:(?:${IDENTIFIER}|\$\{[^}]*\})\s*\.\s*)?`;
const TABLE_REF = String.raw`(?:ONLY\s+)?${SCHEMA}${IDENTIFIER}`;
const OWNED_NAME = String.raw`(?:"(?:${NAMES})"|(?:${NAMES})(?![\w$]))`;
const TARGET = String.raw`(?:ONLY\s+)?${SCHEMA}(${OWNED_NAME})`;
const WRITE = new RegExp(String.raw`(?<!\bFOR\s+)\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO)\s+${TARGET}`, 'gi');
const TRUNCATE = new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?((?:${TABLE_REF}\s*,\s*)*${TABLE_REF})`, 'gi');
const TRUNCATED_TABLE = new RegExp(String.raw`(?:^|,)\s*${TARGET}`, 'gi');
/** A row lock, and the aliases it names (`FOR SHARE OF s, m`), if any. */
const LOCK = /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b(?:\s+OF\s+([\w\s,]+?))?(?=\s*(?:NOWAIT|SKIP\s+LOCKED|\)|;|$|\bFOR\b|\bLIMIT\b))/gi;
const SOURCE_TABLE = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(?:ONLY\s+)?${SCHEMA}"?(\w+)"?(?:\s+(?:AS\s+)?(?!(?:WHERE|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ON|USING|ORDER|GROUP|LIMIT|FOR|UNION|WINDOW|HAVING|AS)\b)(\w+))?`, 'gi');
// Keep the raw-text prefilter looser than the SQL patterns: quotes and whitespace can be escaped in source.
const MENTIONS_WRITE = /UPDATE|INSERT|DELETE|MERGE|TRUNCATE/i;
const MENTIONS_OWNED_TABLE = new RegExp(NAMES, 'i');
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
const isTest = file => file.startsWith('services/app/test/') || /\.test\.\w+$/.test(file) || /(^|\/)__tests__\//.test(file);

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

const tableName = identifier => identifier.replace(/^"|"$/g, '').toLowerCase();

/** Each owned target in a literal write, including every listed TRUNCATE target. */
function* writtenTables(statement) {
  for (const match of statement.matchAll(WRITE)) yield [match[1].replace(/\s+/g, ' ').toUpperCase(), tableName(match[2])];
  for (const [, tables] of statement.matchAll(TRUNCATE)) {
    for (const match of tables.matchAll(TRUNCATED_TABLE)) yield ['TRUNCATE', tableName(match[1])];
  }
}

/** Policy: files ({ path, text }, repository-relative) → one readable line per refused write. */
export function tableOwnershipViolations(files) {
  const violations = [];
  for (const { path: file, text } of files) {
    if (!SOURCE.test(file) || isTest(file) || file.startsWith(FIXTURES)) continue;
    const writes = MENTIONS_WRITE.test(text) && MENTIONS_OWNED_TABLE.test(text);
    const locks = !file.startsWith(IDENTITY_OWNER) && MENTIONS_LOCK.test(text) && LOCK_TABLE.test(text);
    if (!writes && !locks) continue;
    for (const literal of literals(file, text)) {
      if (writes) for (const [operation, table] of writtenTables(literal.text)) {
        const owner = OWNERS.get(table);
        if ((owner && file.startsWith(owner)) || EXCEPTIONS[file]?.[operation]?.includes(table)) continue;
        const action = owner === IDENTITY_OWNER ? 'call the identity service (lib/platform services().identity) instead'
          : owner ? `call a ${owner.slice('services/app/'.length, -1)} function with this transaction instead`
          : 'retained table has no product writer';
        violations.push(`  ${file}:${literal.line} ${operation} ${table} — ${action}`);
      }
      if (locks) for (const table of lockedIdentityTables(literal.text))
        violations.push(`  ${file}:${literal.line} row lock on ${table} — identity rows are read, never locked, outside the identity module (an advisory lock serialises an app invariant)`);
    }
  }
  return violations;
}

/** Make schema growth and stale or duplicate policy entries fail validation. */
function appCoverageViolations() {
  const declared = new Set(TABLES.map(table => table.name));
  const covered = new Set();
  const problems = [];
  for (const [table] of appOwners) {
    if (!declared.has(table)) problems.push(`  ${table} no longer declared in the app schema`);
    if (covered.has(table)) problems.push(`  ${table} has multiple app ownership entries`);
    covered.add(table);
  }
  for (const table of declared) if (!covered.has(table)) problems.push(`  ${table} has no app ownership entry`);
  return problems;
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
  const violations = [...appCoverageViolations(), ...tableOwnershipViolations(scanSources(root))];
  if (violations.length) {
    console.error(`[table ownership] ${violations.length} policy violation(s):\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`[table ownership] ${OWNERS.size} app and identity tables checked (literal writes and identity locks) (${Math.round(performance.now() - started)} ms).`);
}
