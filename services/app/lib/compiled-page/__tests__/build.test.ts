/** The server's view of the shared island build: `loadCompilerBuild()` reads the manifest the build wrote (contract CompilerBuild). */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadCompilerBuild, parseCompilerBuild, ISLANDS_MANIFEST_PATH } from '../build.server';

describe('loadCompilerBuild', () => {
  it('reads public/islands/manifest.json (built by the test global setup beside the story runtime)', () => {
    expect(existsSync(path.resolve(process.cwd(), ISLANDS_MANIFEST_PATH))).toBe(true);
    const build = loadCompilerBuild();
    expect(build.id).toMatch(/^[0-9a-f]{16}$/);
    for (const specifier of ['@mx/rt', '@mx/boot', '@mx/kit/tabs']) expect(build.manifest[specifier], specifier).toMatch(/^\/islands\//);
  });
  it('is read once per process in production and re-read in development', () => {
    expect(loadCompilerBuild()).toBe(loadCompilerBuild());
  });
});

describe('parseCompilerBuild', () => {
  const manifest = (extra: Record<string, unknown> = {}): string => JSON.stringify({
    build: '0123456789abcdef',
    manifest: { '@mx/rt': '/islands/rt-1111111111111111.js', '@mx/boot': '/islands/boot-2222222222222222.js' },
    files: { '/islands/rt-1111111111111111.js': { raw: 1, imports: [] }, '/islands/boot-2222222222222222.js': { raw: 1, imports: ['/islands/rt-1111111111111111.js'] } },
    ssr: { url: '/islands/ssr-3333333333333333.js', exports: { '@mx/rt': 'rt' } },
    sqliteWasm: '/islands/sqlite3-4444444444444444.wasm',
    ...extra,
  });

  it('parses the id, manifest, import graph, server half and SQLite wasm the build wrote', () => {
    const build = parseCompilerBuild(manifest(), 'm.json');
    expect(build.id).toBe('0123456789abcdef');
    expect(build.manifest).toEqual({ '@mx/rt': '/islands/rt-1111111111111111.js', '@mx/boot': '/islands/boot-2222222222222222.js' });
    expect(build.graph).toEqual({ '/islands/rt-1111111111111111.js': [], '/islands/boot-2222222222222222.js': ['/islands/rt-1111111111111111.js'] });
    expect(build.ssr).toEqual({ url: '/islands/ssr-3333333333333333.js', exports: { '@mx/rt': 'rt' } });
    expect(build.sqliteWasm).toBe('/islands/sqlite3-4444444444444444.wasm');
  });

  it('yields a build without a server half when the manifest has none', () => {
    expect(parseCompilerBuild(manifest({ ssr: undefined }), 'm.json').ssr).toBeUndefined();
  });

  it('rejects a server half outside /islands/<name>.js', () => {
    for (const url of ['https://cdn.example/islands/ssr-1.js', '/islands/../ssr-1.js', '/islands/nested/ssr-1.js', '/islands/ssr-1.css', '/other/ssr-1.js', 7]) {
      expect(() => parseCompilerBuild(manifest({ ssr: { url, exports: { '@mx/rt': 'rt' } } }), 'm.json'), String(url)).toThrow(/server half/);
    }
    expect(() => parseCompilerBuild(manifest({ ssr: { url: '/islands/ssr-1.js' } }), 'm.json')).toThrow(/server half/);
  });

  it('rejects a malformed build id, a chunk outside /islands/ and an invalid SQLite wasm URL', () => {
    expect(() => parseCompilerBuild(manifest({ build: 'short' }), 'm.json')).toThrow(/build id/);
    expect(() => parseCompilerBuild(manifest({ manifest: { '@mx/rt': 'https://x/rt.js' } }), 'm.json')).toThrow(/outside \/islands\//);
    expect(() => parseCompilerBuild(manifest({ sqliteWasm: '/islands/other.wasm' }), 'm.json')).toThrow(/SQLite wasm/);
  });
});
