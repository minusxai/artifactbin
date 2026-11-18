/**
 * The run's page runtime build, shared by its workers (test/setup/html-assets-file.ts, build-runtime.global.ts): the
 * first runtime to ask compiles it and keeps it whole, every other reads that instead of compiling, a failed compile
 * sends them to compile their own, and this suite's api workers share it.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, inject, it } from 'vitest';
import { buildHtmlAssets } from '@/lib/html-runtime/server';
import { htmlAssetsSupply, readHtmlAssets, removeHtmlAssets } from '@/test/setup/html-assets-file';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';

const scratch = tempDirSync('html-assets-',afterAll);
const assets = { core: 'core', apollo: 'apollo', apolloPath: '/af/apollo.js', reader: 'reader', readerPath: '/af/reader.js' };
const quick = { pollMs: 5 };

it('lets the first runtime compile, and the others read what it keeps, whole', async () => {
  const file = path.join(scratch, 'run', 'build.json');
  const first = htmlAssetsSupply(file, quick), second = htmlAssetsSupply(file, quick);
  expect(await first.read()).toBeUndefined();
  const waiting = second.read();
  first.built(assets);
  expect(await waiting).toEqual(assets);
  expect(await htmlAssetsSupply(file).read()).toEqual(assets);
  // Only the one that compiles keeps anything.
  second.built({ ...assets, core: 'another' });
  expect(await readHtmlAssets(file)).toEqual(assets);
  expect(readdirSync(path.dirname(file)).sort()).toEqual(['build.json', 'build.json.lock']);
  removeHtmlAssets(file);
  expect(readdirSync(path.dirname(file))).toEqual([]);
});

it('sends the others to compile their own when the first compile fails, or nothing lands in time', async () => {
  const file = path.join(scratch, 'failed.json');
  const first = htmlAssetsSupply(file, quick), second = htmlAssetsSupply(file, quick);
  expect(await first.read()).toBeUndefined();
  first.failed();
  expect(await second.read()).toBeUndefined();
  expect(existsSync(file)).toBe(false);
  const stalled = path.join(scratch, 'stalled.json');
  expect(await htmlAssetsSupply(stalled, quick).read()).toBeUndefined();
  expect(await htmlAssetsSupply(stalled, { timeoutMs: 20, pollMs: 5 }).read()).toBeUndefined();
});

it('is what this suite\'s api workers answer for buildHtmlAssets: one build per run, kept in the run\'s file', async () => {
  const file = inject('htmlAssetsFile');
  expect(file, 'vitest.config.ts provides htmlAssetsShared to the api projects').toMatch(/html-runtime-assets/);
  const built = await buildHtmlAssets();
  expect(built.core).toBeTruthy();
  expect(await readHtmlAssets(file!, { timeoutMs: 0 })).toEqual(built);
});
