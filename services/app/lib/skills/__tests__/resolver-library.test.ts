/**
 * The copyable backend function library (skills/artifactbin/resolvers/resolver-*.ts): every file publishes as a
 * function file (no typeDefs) with an owner-only `test` function, every secret it uses is declared and bound to a
 * host, and its header says how to call it from the page (fetch('/fn/NAME')) and how to use it from its own folder.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {functionFileSurface} from '@/lib/page-operations';
import {secretHostMap} from '@/lib/html-backend-secrets';

const dir = new URL('../../../skills/artifactbin/resolvers/', import.meta.url);
const files = readdirSync(dir).sort();

it('ships the library the guide lists', () => {
  expect(files).toEqual(['bigquery', 'google-sheets', 'http-json', 'neon', 'public-url', 'supabase'].map((name) => `resolver-${name}.ts`));
  const guide = readFileSync(new URL('../references/functions.md', dir), 'utf8');
  for (const file of files) expect(guide, file).toContain('`' + file + '`');
});

it.each(files)('%s publishes as functions with an owner-only test and binds every secret it uses', async (file) => {
  const source = readFileSync(new URL(file, dir), 'utf8');
  const resolver = await import(`../../../skills/artifactbin/resolvers/${file}`);
  const {functions} = await functionFileSurface(source);
  expect(functions.test, file).toBe('owner');
  expect(Object.keys(functions).length, file).toBeGreaterThan(1);
  expect(typeof resolver.default.test).toBe('function');
  expect(source, file).not.toMatch(/typeDefs|@auth|caps\.query/);
  // The header says how the page calls one of its functions.
  const header = source.slice(0, source.indexOf('*/'));
  expect(header, file).toMatch(new RegExp(`fetch\\('/fn/(${Object.keys(functions).join('|')})\\b`));
  // Secrets the code uses (the header may name alternatives): placeholders and google auth.
  const code = source.slice(source.indexOf('*/'));
  const used = new Set([...code.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g), ...code.matchAll(/secret: '([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]));
  const declared = resolver.secrets ? Object.keys(secretHostMap(resolver.secrets)) : [];
  for (const name of used) expect(declared, `${file}: ${name}`).toContain(name);
  // The resolver contract: no removed store or secret reads.
  expect(source).not.toMatch(/caps\s*\.\s*store|secrets\s*\.\s*get|secretBindings/);
  for (const label of ['Usage:', 'Next:', 'Gotchas:']) expect(source.slice(0, source.indexOf('*/')), `${file} ${label}`).toContain(label);
  expect(source.slice(0, source.indexOf('*/')), file).toContain(`cp resolvers/${file} `);
});

it('public-url reads quoted CSV fields and reports the row count in its test', async () => {
  const {default: resolver} = await import('../../../skills/artifactbin/resolvers/resolver-public-url');
  const caps = {fetch: async () => ({ok: true, status: 200, text: async () => 'name,value\n"Oak, red",12\nPine,\n'})};
  expect(await resolver.rows({}, null, caps)).toEqual([{name: 'Oak, red', value: 12}, {name: 'Pine', value: null}]);
  // A GET input arrives as a string.
  expect(await resolver.rows({limit: '1'}, null, caps)).toEqual([{name: 'Oak, red', value: 12}]);
  expect(await resolver.test({}, null, caps)).toMatch(/^Read 2 rows from /);
});

