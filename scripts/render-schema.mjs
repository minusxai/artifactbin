#!/usr/bin/env node
/**
 * ONE RENDERED SCHEMA. Each package declares its own tables; this script renders
 * both sides into the three bootstrap SQL files at the repo root:
 *
 *   SCHEMA.sql  — the tables (app.* from lib/schema.ts, auth.* from the proxy's
 *                 schema module, events.* from the events service's), a
 *                 FRESH-database / CI artifact
 *   roles.sql   — one LOGIN role per package and the schema each one OWNS
 *                 (Addendum 2: AUTHORIZATION, not grants — USAGE-only left the
 *                 app role unable to run its own DDL)
 *   grants.sql  — the cross-schema READS: the proxy's SELECT on app.tokens and
 *                 the app's SELECT on events.events, applied AFTER the boot
 *                 that creates each table
 *
 * `npm run render:schema` writes the three files; `--json` prints
 * { schema, roles, grants, tables } instead (same bytes as the files) — that is
 * what __tests__/schema-sql-fresh.test.ts and lib/__tests__/schema-ownership.test.ts
 * consume, so there is ONE resolver of "what is declared" and it cannot drift
 * from the tests.
 *
 * The declarations are imported READ-ONLY — lib/schema.ts is the app's, the
 * proxy's schema module is the proxy's; this script never edits either and
 * renders exactly what is declared, even when two packages still declare one
 * table (the ownership test is what says that is wrong, naming the table).
 *
 * Runs under plain `node` (the tests exec it that way), so the TypeScript
 * declarations are imported through tsx's `tsImport` — the same loader
 * `npm run dev` runs the server under.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { getMigrations } from 'better-auth/db/migration';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const APP_SCHEMA = 'app';
const AUTH_SCHEMA = 'auth';
const EVENTS_SCHEMA = 'events';

/* ── declaration shapes ───────────────────────────────────────────────────
 * A package may declare its tables as Table data (the preferred shape — it
 * renders through the SAME utils renderSchema boot uses), as raw DDL strings,
 * or as an ensure-style applier this script records through a capturing stub.
 * The wave that owns each package is mid-move between these shapes, so all
 * three are accepted; an unknown shape is a loud build failure, never silence.
 */

const isTable = (x) =>
  !!x && typeof x === 'object' && typeof x.name === 'string' && Array.isArray(x.columns) && Array.isArray(x.primaryKey);

/** An exported Table[] (or a single exported Table) — the preferred shape. */
function tableData(mod) {
  for (const v of Object.values(mod)) {
    if (Array.isArray(v) && v.length > 0 && v.every(isTable)) return v;
  }
  for (const v of Object.values(mod)) {
    if (isTable(v)) return [v];
  }
  return null;
}

/** An exported array of raw DDL statements. */
function ddlStatements(mod) {
  for (const v of Object.values(mod)) {
    if (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string')) return v;
  }
  return null;
}

/** An ensure-style applier, recorded through a Queryable that captures every statement it runs. */
async function recordedStatements(mod) {
  const applier = Object.entries(mod).find(
    ([name, v]) => typeof v === 'function' && /^ensure\w*$/i.test(name),
  );
  if (!applier) return null;
  const statements = [];
  await applier[1]({
    query: async (sql) => {
      statements.push(sql);
      return { rows: [] };
    },
  });
  return statements;
}

/* ── qualification ────────────────────────────────────────────────────────
 * Raw DDL arrives unqualified (it is applied through a search_path today).
 * These are exactly the three statement forms utils renderSchema emits, so the
 * re-qualified text is byte-identical to renderSchema(tables, { schema }) —
 * the reason the fallback cannot drift from the preferred path. Every
 * statement must end up naming the schema; one that does not is a shape this
 * script does not know, and that is a build failure, never quietly wrong SQL.
 */
function qualify(statements, schema) {
  const qualified = statements.map((s) =>
    s
      .replace(/^CREATE TABLE IF NOT EXISTS (\w+)\s*\(/, `CREATE TABLE IF NOT EXISTS ${schema}.$1 (`)
      .replace(/^ALTER TABLE (\w+) /, `ALTER TABLE ${schema}.$1 `)
      // `USING <method>` sits between the table and the column list, so the
      // qualifier steps over it — otherwise a GIN index reads as a shape this
      // script does not know and the build fails.
      .replace(/^(CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON) (\w+)( USING \w+)?\s*\(/, `$1 ${schema}.$2$3 (`),
  );
  for (const [i, s] of qualified.entries()) {
    if (!s.includes(`${schema}.`)) {
      throw new Error(`render-schema: statement ${i} is not a form I know how to qualify under "${schema}":\n${s}`);
    }
  }
  return qualified;
}

/** The table names a set of DDL statements declares — for the ownership map. */
const tableNames = (statements) => {
  const names = [];
  for (const s of statements) {
    const m = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s);
    if (m) names.push(m[1]);
  }
  if (names.length === 0) throw new Error('render-schema: no CREATE TABLE found in the declarations');
  return names;
};

/* ── the two sides ───────────────────────────────────────────────────────── */

const { renderSchema } = await tsImport('@artifactbin/utils', import.meta.url);

async function appSide() {
  const mod = await tsImport('../services/app/lib/schema.ts', import.meta.url);
  const data = tableData(mod);
  if (data) return { statements: renderSchema(data, { schema: APP_SCHEMA }), names: data.map((t) => t.name) };
  if (Array.isArray(mod.SCHEMA_STATEMENTS)) {
    // The pre-split shape: statements already rendered (unqualified) by the
    // same utils renderer — re-qualified, which is byte-identical to the path
    // above once TABLES is exported.
    return { statements: qualify(mod.SCHEMA_STATEMENTS, APP_SCHEMA), names: tableNames(mod.SCHEMA_STATEMENTS) };
  }
  throw new Error('render-schema: lib/schema.ts declares neither Table data nor SCHEMA_STATEMENTS');
}

// The proxy's declarations: where the proxy wave is moving them, then where
// they live today. Prefer the new path the moment it exists.
const PROXY_MODULES = [
  '../services/proxy/src/schema.ts',
  '../packages/proxy/src/identity/schema.ts',
];

async function proxySide() {
  const rel = PROXY_MODULES.find((p) => fs.existsSync(path.resolve(SCRIPT_DIR, p)));
  if (!rel) {
    throw new Error(`render-schema: no proxy table declarations found (looked for ${PROXY_MODULES.join(', ')})`);
  }
  const mod = await tsImport(rel, import.meta.url);
  const data = tableData(mod);
  if (data) return { statements: renderSchema(data, { schema: AUTH_SCHEMA }), names: data.map((t) => t.name) };
  const raw = ddlStatements(mod) ?? (await recordedStatements(mod));
  if (!raw) {
    throw new Error(`render-schema: ${rel} declares tables in no shape I know (Table data, DDL statements, or an ensure applier)`);
  }
  return { statements: qualify(raw, AUTH_SCHEMA), names: tableNames(raw) };
}

/**
 * The events service's declarations. It owns `events.*` and is its only writer;
 * the app reads the log through the grant below, exactly as the proxy reads the
 * app's tokens table.
 */
async function eventsSide() {
  const mod = await tsImport('../services/events/src/schema.ts', import.meta.url);
  const data = tableData(mod);
  if (!data) throw new Error('render-schema: services/events/src/schema.ts declares no Table data');
  return { statements: renderSchema(data, { schema: EVENTS_SCHEMA }), names: data.map((t) => t.name) };
}

/** Better Auth's own migration compiler, over the exact pure runtime options. */
async function betterAuthSide() {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE SCHEMA IF NOT EXISTS ${AUTH_SCHEMA}`);
    const { pgliteDialect } = await tsImport('../services/proxy/src/auth/pglite.ts', import.meta.url);
    const kysely = new Kysely({ dialect: pgliteDialect(pg) });
    const { humanAuthOptions } = await tsImport('../services/proxy/src/auth/human.ts', import.meta.url);
    const cfg = {
      secret: 'schema-renderer-secret-schema-renderer-secret',
      baseURL: 'http://schema.invalid',
      mail: { send: async () => {} },
    };
    const options = humanAuthOptions(cfg, kysely.withSchema(AUTH_SCHEMA));
    const migrations = await getMigrations(options);
    return await migrations.compileMigrations();
  } finally {
    await pg.close();
  }
}

/* ── the three files ─────────────────────────────────────────────────────── */

const section = (title, statements) =>
  `-- ${title}\n\n` + statements.map((s) => `${s};`).join('\n\n') + '\n';

function render() {
  return Promise.all([appSide(), proxySide(), eventsSide(), betterAuthSide()]).then(([app, proxy, events, betterAuth]) => {
    const schema = [
      '-- SCHEMA.sql — ONE rendered schema, generated by scripts/render-schema.mjs',
      '-- (npm run render:schema). Never edit by hand: each package declares its own',
      '-- tables and this file is both sides rendered together, so it cannot drift',
      '-- from either declaration.',
      '--',
      '-- A FRESH-database / CI artifact, NOT something boot applies: Better',
      "-- Auth's DDL has no IF NOT EXISTS, so",
      '-- this file is for a clean database only. Boot still uses the additive',
      '-- ensureTable (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS) — the',
      '-- two cannot disagree because both render the same declarations.',
      '--',
      '-- Apply order on a fresh database: roles.sql (the schemas, with their',
      '-- owners) → SCHEMA.sql → grants.sql.',
      '',
      '-- Better Auth tables — generated by getMigrations(...).compileMigrations().',
      '-- No IF NOT EXISTS: this block is for a fresh database only.',
      betterAuth,
      '',
      section(`schema "${APP_SCHEMA}" — owned by the app role; tables declared by lib/schema.ts`, app.statements),
      section(`schema "${AUTH_SCHEMA}" — owned by the proxy role; tables declared by the proxy's schema module`, proxy.statements),
      section(`schema "${EVENTS_SCHEMA}" — owned by the events role; tables declared by services/events/src/schema.ts`, events.statements),
    ].join('\n') + '\n';

    const roles = [
      '-- roles.sql — one LOGIN role per package and the schema each one OWNS, for a FRESH',
      '-- database. Generated by scripts/render-schema.mjs (npm run render:schema);',
      "-- never edit by hand. Passwords are the operator's business — nothing in",
      '-- code names a role.',
      '--',
      '-- Ownership (AUTHORIZATION) carries every privilege inside a schema, so',
      '-- nothing further is granted here, for existing objects or future ones:',
      '-- widening anything would let the proxy read app.artifacts. The',
      '-- cross-schema READS (the proxy on the tokens table, the app on the event',
      '-- log) live in grants.sql, applied after the boot that creates each table.',
      '',
      'CREATE ROLE artifactbin_app    LOGIN;',
      'CREATE ROLE artifactbin_proxy  LOGIN;',
      'CREATE ROLE artifactbin_events LOGIN;',
      '',
      'CREATE SCHEMA app AUTHORIZATION artifactbin_app;',
      'CREATE SCHEMA auth AUTHORIZATION artifactbin_proxy;',
      "-- The events service is the log's ONLY writer; every other process reads it.",
      'CREATE SCHEMA events AUTHORIZATION artifactbin_events;',
      '',
      '-- The proxy must reach the app schema at all to read its tokens table.',
      'GRANT USAGE ON SCHEMA app TO artifactbin_proxy;',
      '-- …and the app must reach the events schema at all to read the log.',
      'GRANT USAGE ON SCHEMA events TO artifactbin_app;',
    ].join('\n') + '\n';

    const grants = [
      '-- grants.sql — the cross-schema READS, and nothing else: the proxy reads the',
      "-- app's tokens table (an indexed SELECT through utils createTokenReader) and",
      '-- the app reads the event log the events service owns and alone writes.',
      '-- Generated by scripts/render-schema.mjs (npm run render:schema); never edit',
      '-- by hand.',
      '--',
      '-- Applied AFTER the boot that creates each table: neither exists on a fresh',
      "-- database until its owner's additive DDL creates it, and applying this any",
      '-- earlier aborts init (compose runs each leg as a one-shot between its',
      "-- owner's :healthy and the reader's :up).",
      '',
      'GRANT SELECT ON app.tokens TO artifactbin_proxy;',
      'GRANT SELECT ON events.events TO artifactbin_app;',
    ].join('\n') + '\n';

    const tables = {};
    for (const name of app.names) tables[`${APP_SCHEMA}.${name}`] = 'app';
    for (const name of proxy.names) tables[`${AUTH_SCHEMA}.${name}`] = 'proxy';
    for (const name of events.names) tables[`${EVENTS_SCHEMA}.${name}`] = 'events';

    return { schema, roles, grants, tables };
  });
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const out = await render();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out));
} else {
  for (const [file, content] of [['SCHEMA.sql', out.schema], ['roles.sql', out.roles], ['grants.sql', out.grants]]) {
    fs.writeFileSync(path.join(ROOT, file), content);
    console.log(`${file}: ${content.split('\n').length} lines`);
  }
  console.log('tables: ' + Object.keys(out.tables).sort().join(', '));
}
