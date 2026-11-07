/**
 * The copyable resolver library (skills/artifactbin/resolvers/resolver-*.ts): every file's schema compiles under the
 * platform's resolver rules with a valid owner-only `test` field, every secret it uses is declared and bound to a
 * host, it uses only caps.fetch, caps.query and caps.sql, and its header says how to use it from its own folder.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {declaresResolverTest} from '@/lib/page-operations';
import {secretHostMap} from '@/lib/html-backend-secrets';

const dir = new URL('../../../skills/artifactbin/resolvers/', import.meta.url);
const files = readdirSync(dir).sort();

it('ships the library the guide lists', () => {
  expect(files).toEqual(['bigquery', 'google-sheets', 'http-json', 'neon', 'public-url', 'supabase'].map((name) => `resolver-${name}.ts`));
  const guide = readFileSync(new URL('../references/resolvers.md', dir), 'utf8');
  for (const file of files) expect(guide, file).toContain('`' + file + '`');
});

it.each(files)('%s compiles with a test field and binds every secret it uses', async (file) => {
  const source = readFileSync(new URL(file, dir), 'utf8');
  const resolver = await import(`../../../skills/artifactbin/resolvers/${file}`);
  expect(declaresResolverTest(resolver.typeDefs), file).toBe(true);
  expect(typeof resolver.default.test).toBe('function');
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
  expect(await resolver.test({}, null, caps)).toMatch(/^Read 2 rows from /);
});

