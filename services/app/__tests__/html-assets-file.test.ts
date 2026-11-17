/**
 * The run's page runtime build, shared by its workers (test/setup/html-assets-file.ts, build-runtime.global.ts): the
 * global setup writes it whole or marks its failure, a worker waits for it and falls back to its own compile when it
 * never lands, and this suite's api workers read it rather than compile.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { buildHtmlAssets } from '@/lib/html-runtime/server';
import { readHtmlAssets, removeHtmlAssets, writeHtmlAssets } from '@/test/setup/html-assets-file';

const scratch = mkdtempSync(path.join(tmpdir(), 'html-assets-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const assets = { core: 'core', apollo: 'apollo', apolloPath: '/af/apollo.js', reader: 'reader', readerPath: '/af/reader.js' };

describe('the shared build file', () => {
  it('is read once it lands, whole, and leaves no partial file', async () => {
    const file = path.join(scratch, 'later', 'build.json');
    let land!: (value: typeof assets) => void;
    const written = writeHtmlAssets(file, new Promise((resolve) => { land = resolve; }));
    const read = readHtmlAssets(file, { pollMs: 5 });
    land(assets);
    await written;
    expect(await read).toEqual(assets);
    expect(readdirSync(path.dirname(file))).toEqual(['build.json']);
  });

  it('answers nothing for a failed build, or one that never lands, so the worker compiles its own', async () => {
    const failed = path.join(scratch, 'failed.json');
    await writeHtmlAssets(failed, Promise.reject(new Error('the build broke')));
    expect(existsSync(failed)).toBe(false);
    expect(await readHtmlAssets(failed, { pollMs: 5 })).toBeUndefined();
    expect(await readHtmlAssets(path.join(scratch, 'never.json'), { timeoutMs: 20, pollMs: 5 })).toBeUndefined();
    removeHtmlAssets(failed);
    expect(readdirSync(scratch).filter((name) => name.startsWith('failed'))).toEqual([]);
  });
});

it('is what this suite\'s api workers answer for buildHtmlAssets, built once by the global setup', async () => {
  const file = inject('htmlAssetsFile');
  expect(file, 'vitest.config.ts provides htmlAssetsShared to the api projects').toMatch(/html-runtime-assets/);
  const shared = await readHtmlAssets(file!);
  expect(shared?.core).toBeTruthy();
  expect(await buildHtmlAssets()).toEqual(shared);
});
