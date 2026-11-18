/** lib/sql's composition extensions: the module a root names is loaded once and installed process-wide; none clears it. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, onTestFinished } from 'vitest';
import { sqlExtensions, useSqlExtensions } from '@/lib/sql';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';

afterEach(() => useSqlExtensions(undefined));

it('installs the default export of the named module, an empty set for a module without one, and clears on none', async () => {
  const dir = tempDirSync('sql-extensions-',onTestFinished);
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
