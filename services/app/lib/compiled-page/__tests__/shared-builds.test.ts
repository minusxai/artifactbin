/** Retained shared builds (shared-builds.server.ts): what is archived and in which order, and how a retained build or file is found. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadCompilerBuild, ISLANDS_MANIFEST_PATH } from '../build.server';
import { archiveSharedBuild, retainedBuild, retainedIslandFile } from '../shared-builds.server';

const memory = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), puts: [] as string[], gets: [] as string[] }));

vi.mock('@/lib/object-store', async (original) => {
  const real = await original<typeof import('@/lib/object-store')>();
  return {
    ...real,
    objectStore: () => ({
      backend: 'local',
      async put(key: string, body: Buffer) { memory.puts.push(key); memory.objects.set(key, Buffer.from(body)); },
      async get(key: string) {
        memory.gets.push(key);
        const bytes = memory.objects.get(key);
        if (!bytes) throw new real.ObjectUnavailable(key, new Error('missing'));
        return bytes;
      },
      async delete(key: string) { memory.objects.delete(key); },
      getStream() { throw new Error('not used'); },
    }),
  };
});

beforeEach(() => { memory.objects.clear(); memory.puts.length = 0; memory.gets.length = 0; });

const manifestText = readFileSync(path.resolve(process.cwd(), ISLANDS_MANIFEST_PATH));

describe('archiveSharedBuild', () => {
  it('stores every file of the build manifest (files ∪ ssr.url), and the manifest last', async () => {
    const build = loadCompilerBuild();
    const raw = JSON.parse(manifestText.toString('utf8')) as { build: string; files: Record<string, unknown>; ssr: { url: string } };
    const expected = new Set([...Object.keys(raw.files), raw.ssr.url].map((url) => `island-builds/${url.slice('/islands/'.length)}`));
    const read = vi.fn((name: string) => (name === 'manifest.json' ? manifestText : Buffer.from(`bytes of ${name}`)));

    await archiveSharedBuild(build, read);

    expect(memory.puts.at(-1)).toBe(`island-builds/manifest-${raw.build}.json`);
    expect(new Set(memory.puts.slice(0, -1))).toEqual(expected);
    expect(memory.puts.length).toBe(expected.size + 1);
    expect(memory.objects.get(`island-builds/manifest-${raw.build}.json`)).toEqual(manifestText);
    expect(memory.objects.get(`island-builds/${raw.ssr.url.slice('/islands/'.length)}`)?.toString()).toBe(`bytes of ${raw.ssr.url.slice('/islands/'.length)}`);

    // The same build again in this process archives nothing more.
    await archiveSharedBuild(build, read);
    expect(memory.puts.length).toBe(expected.size + 1);
  });

  it('refuses a manifest that names another build than the one being archived, storing no manifest', async () => {
    const other = { ...loadCompilerBuild(), id: '0123456789abcdef' };
    await expect(archiveSharedBuild(other, (name) => (name === 'manifest.json' ? manifestText : Buffer.from('')))).rejects.toThrow(/changed while archiving/);
    expect(memory.puts.filter((key) => key.includes('manifest-'))).toEqual([]);
  });
});

describe('retainedBuild', () => {
  const id = 'fedcba9876543210';
  const text = JSON.stringify({ build: id, manifest: { '@mx/rt': '/islands/rt-1111111111111111.js' }, files: { '/islands/rt-1111111111111111.js': { imports: [] } }, ssr: { url: '/islands/ssr-2222222222222222.js', exports: { '@mx/rt': 'rt' } } });

  it('returns null for an id that is not 16 hex characters, without asking the store', async () => {
    expect(await retainedBuild('../manifest')).toBeNull();
    expect(await retainedBuild('FEDCBA9876543210')).toBeNull();
    expect(memory.gets).toEqual([]);
  });

  it('does not cache a miss: a build archived after the first lookup is found', async () => {
    expect(await retainedBuild(id)).toBeNull();
    memory.objects.set(`island-builds/manifest-${id}.json`, Buffer.from(text));
    const found = await retainedBuild(id);
    expect(found?.id).toBe(id);
    expect(found?.manifest['@mx/rt']).toBe('/islands/rt-1111111111111111.js');
    expect(found?.ssr?.url).toBe('/islands/ssr-2222222222222222.js');
    // A hit is cached: the store is not asked again.
    const asked = memory.gets.length;
    expect(await retainedBuild(id)).toBe(found);
    expect(memory.gets.length).toBe(asked);
  });
});

describe('retainedIslandFile', () => {
  it('returns null for a name outside the island file shape, and the bytes or null for a well-formed one', async () => {
    memory.objects.set('island-builds/rt-1111111111111111.js', Buffer.from('rt'));
    expect(await retainedIslandFile('../x')).toBeNull();
    expect(await retainedIslandFile('../island-builds/rt-1111111111111111.js')).toBeNull();
    expect(memory.gets).toEqual([]);
    expect((await retainedIslandFile('rt-1111111111111111.js'))?.toString()).toBe('rt');
    expect(await retainedIslandFile('tabs-3333333333333333.js')).toBeNull();
  });
});
