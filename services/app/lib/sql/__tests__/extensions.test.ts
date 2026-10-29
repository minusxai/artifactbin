/** lib/sql's composition extensions: the module a root names is loaded once and installed process-wide; none clears it. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { sqlExtensions, useSqlExtensions } from '@/lib/sql';

afterEach(() => useSqlExtensions(undefined));

it('installs the default export of the named module, an empty set for a module without one, and clears on none', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sql-extensions-'));
  const withDefault = path.join(dir, 'with-default.mjs'), without = path.join(dir, 'without.mjs');
  writeFileSync(withDefault, 'export default { functions: { answer: 42 } };\n');
  writeFileSync(without, 'export const unrelated = 1;\n');
  expect(sqlExtensions()).toEqual({});
  await useSqlExtensions(pathToFileURL(withDefault).href);
  expect(sqlExtensions()).toEqual({ functions: { answer: 42 } });
  await useSqlExtensions(pathToFileURL(without).href);
  expect(sqlExtensions()).toEqual({});
  await useSqlExtensions(pathToFileURL(withDefault).href);
  await useSqlExtensions(undefined);
  expect(sqlExtensions()).toEqual({});
  await expect(useSqlExtensions(pathToFileURL(path.join(dir, 'missing.mjs')).href)).rejects.toThrow();
});
