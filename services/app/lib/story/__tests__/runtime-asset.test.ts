/**
 * The runtime manifest — the build telling the server where it put the bundle.
 *
 * Run against the REAL manifest the suite's global setup builds, not a fixture:
 * the whole point of the indirection is that the name is not knowable ahead of
 * time, and a fixture would test a shape nobody ships. The malformed cases get
 * a fixture, since a build cannot be asked to produce one.
 */
import { KIT_CHUNK_IDS } from '@/lib/story-ui/kit-chunks';
import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  storyRuntimeSrc, storyRuntimeAssets, readStoryRuntimeManifest, resetStoryRuntimeManifest,
} from '@/lib/story/runtime-asset';

afterEach(() => resetStoryRuntimeManifest());

describe('the built manifest', () => {
  it('names a content-addressed entry that is actually on disk', () => {
    const src = storyRuntimeSrc();
    expect(src).toMatch(/^\/story\/entry-[A-Z0-9]+\.js$/);
    expect(existsSync(path.join(process.cwd(), 'public', src.replace(/^\//, '')))).toBe(true);
  });

  it('names the lazy chart chunk, and it is on disk too', () => {
    const { lazy } = storyRuntimeAssets();
    // Exactly one today: the vega bundle behind QuestionEmbed. A second entry
    // here means something else went lazy and the preload decision in
    // lib/story/document.ts — which fires on "this document draws a chart" —
    // no longer describes the whole list.
    expect(lazy).toHaveLength(1);
    expect(lazy[0]).toMatch(/^\/story\/chunks\/.+\.js$/);
    expect(existsSync(path.join(process.cwd(), 'public', lazy[0].replace(/^\//, '')))).toBe(true);
  });

  it('is read once and cached — the serving route must not stat per request', () => {
    expect(readStoryRuntimeManifest()).toBe(readStoryRuntimeManifest());
  });
});

describe('when the build has not run', () => {
  const fixture = (contents: string | null): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mx-manifest-'));
    const file = path.join(dir, 'manifest.json');
    if (contents !== null) writeFileSync(file, contents);
    return file;
  };

  it('says so, naming the command — rather than serving a document that 404s its runtime', () => {
    resetStoryRuntimeManifest();
    expect(() => readStoryRuntimeManifest(fixture(null))).toThrow(/build:runtime/);
  });

  it('refuses a manifest that does not name an entry under /story/', () => {
    for (const bad of ['{}', '{"entry":42}', '{"entry":"https://evil.example/x.js"}', '{"entry":"/nope/x.js"}']) {
      resetStoryRuntimeManifest();
      expect(() => readStoryRuntimeManifest(fixture(bad)), bad).toThrow(/malformed/);
    }
  });

  it('treats a missing lazy list as empty rather than throwing', () => {
    // Nothing breaks without it: the preload is an optimisation, and the entry
    // still discovers its own chunks the slow way.
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js"}')).lazy).toEqual([]);
  });
});

describe('the reading-position script', () => {
  const fixture = (contents: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mx-manifest-'));
    const file = path.join(dir, 'manifest.json');
    writeFileSync(file, contents);
    return file;
  };

  it('is named by the real build, beside the entry, and is on disk', () => {
    const { anchor } = storyRuntimeAssets();
    expect(anchor).toMatch(/^\/story\/anchor-[A-Z0-9]+\.js$/);
    expect(existsSync(path.join(process.cwd(), 'public', anchor!.replace(/^\//, '')))).toBe(true);
  });

  it('is null for a manifest written before it existed — the entry still serves', () => {
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js"}')))
      .toMatchObject({ entry: '/story/entry-A.js', anchor: null });
  });

  it('is refused if it points off our own origin', () => {
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js","anchor":"https://evil.example/a.js"}')).anchor)
      .toBeNull();
  });

  it('names the page\'s SQLite wasm beside the entry, on disk; none for an older manifest or one off our origin', () => {
    const { sqlite } = storyRuntimeAssets();
    expect(sqlite).toMatch(/^\/story\/sqlite3-[0-9a-f]{16}\.wasm$/);
    expect(existsSync(path.join(process.cwd(), 'public', sqlite!.replace(/^\//, '')))).toBe(true);
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js"}')).sqlite).toBeNull();
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js","sqlite":"https://evil.example/x.wasm"}')).sqlite).toBeNull();
  });
});

describe('the serving path degrades instead of failing', () => {
  /*
   * `storyRuntimeSrc` throws, which is right for a build step and wrong for a
   * read: /a/<id>/raw would answer 500 for EVERY document — prose included,
   * which needs no runtime at all — over a build artifact that has nothing to
   * do with the row being served. A missing or broken runtime bundle must never
   * take the page down with it, so the serving accessor honours that: the
   * document is still SSR'd, readable and indexable; it simply does not
   * hydrate. The build is where this fails loudly
   * (scripts/build-story-runtime.mjs).
   */
  it('answers with no runtime rather than throwing', () => {
    resetStoryRuntimeManifest();
    const missing = path.join(tmpdir(), 'mx-absent', 'manifest.json');
    expect(() => storyRuntimeAssets(missing)).not.toThrow();
    expect(storyRuntimeAssets(missing)).toEqual({ entry: null, anchor: null, comment: null, lazy: [], sqlite: null, entryDeps: [], lazyDeps: {}, mermaid: {}, kit: {} });
  });

  it('still reports the real assets when the build IS there', () => {
    resetStoryRuntimeManifest();
    const assets = storyRuntimeAssets();
    expect(assets.entry).toBe(storyRuntimeSrc());
    expect(assets.lazy.length).toBe(1);
    // Every kit chunk is named with its static closure, the chunk itself first.
    expect(Object.keys(assets.kit).sort()).toEqual([...KIT_CHUNK_IDS].sort());
    for (const closure of Object.values(assets.kit)) expect(closure[0]).toMatch(/^\/story\/chunks\/[\w-]+\.js$/);
  });
});

/*
 * THE STATIC CLOSURES. The entry and the chart chunk each import shared chunks
 * statically, and Mermaid reaches a diagram's module and its layout engine only
 * after the engine runs — every one of those a round trip after its importer
 * parses. The build names them so a document can preload them with it.
 */
describe('the closures the build records', () => {
  const fixture = (contents: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mx-manifest-'));
    const file = path.join(dir, 'manifest.json');
    writeFileSync(file, contents);
    return file;
  };
  const onDisk = (url: string) => existsSync(path.join(process.cwd(), 'public', url.replace(/^\//, '')));

  it("names the entry's static chunks, on disk, without the entry itself", () => {
    const { entry, entryDeps } = storyRuntimeAssets();
    expect(entryDeps.length).toBeGreaterThan(0);
    expect(entryDeps).not.toContain(entry);
    for (const url of entryDeps) {
      expect(url).toMatch(/^\/story\/chunks\/.+\.js$/);
      expect(onDisk(url), url).toBe(true);
    }
  });

  it("names each lazy chunk's static chunks, keyed by the lazy chunk", () => {
    const { lazy, lazyDeps } = storyRuntimeAssets();
    expect(Object.keys(lazyDeps)).toEqual(lazy);
    for (const url of Object.values(lazyDeps).flat()) expect(onDisk(url), url).toBe(true);
    // The chart chunk imports d3 statically: its closure is not empty.
    expect(lazyDeps[lazy[0]].length).toBeGreaterThan(0);
  });

  it('names every Mermaid kind the kit draws, each with the engine and its own diagram module', () => {
    const { mermaid } = storyRuntimeAssets();
    for (const kind of ['flowchart', 'flowchart-elk', 'sequence', 'class', 'state', 'gantt', 'er', 'pie', 'mindmap', 'architecture']) {
      expect(mermaid[kind], kind).toEqual(expect.arrayContaining([expect.stringMatching(/\/story\/chunks\/mermaid-render-[A-Z0-9]+\.js$/)]));
    }
    expect(mermaid.sequence).toEqual(expect.arrayContaining([expect.stringMatching(/\/sequenceDiagram-[A-Z0-9]+-[A-Z0-9]+\.js$/)]));
    expect(mermaid.flowchart).toEqual(expect.arrayContaining([expect.stringMatching(/\/flowDiagram-[A-Z0-9]+-[A-Z0-9]+\.js$/)]));
    for (const url of Object.values(mermaid).flat()) expect(onDisk(url), url).toBe(true);
  });

  it('is empty for a manifest written before the closures existed', () => {
    resetStoryRuntimeManifest();
    expect(readStoryRuntimeManifest(fixture('{"entry":"/story/entry-A.js","lazy":["/story/chunks/V.js"]}')))
      .toMatchObject({ entryDeps: [], lazyDeps: {}, mermaid: {} });
  });

  it('keeps only paths under /story/ — a closure is never a way off our origin', () => {
    resetStoryRuntimeManifest();
    const read = readStoryRuntimeManifest(fixture(JSON.stringify({
      entry: '/story/entry-A.js',
      lazy: ['/story/chunks/V.js'],
      entryDeps: ['/story/chunks/a.js', 'https://evil.example/x.js', 42],
      lazyDeps: { '/story/chunks/V.js': ['/story/chunks/d3.js', '//evil.example/y.js'], 'https://evil.example/z.js': ['/story/chunks/z.js'] },
      mermaid: { flowchart: ['/story/chunks/flow.js', '/nope/x.js'], sequence: 'not a list', 'bad kind"': ['/story/chunks/q.js'] },
    })));
    expect(read.entryDeps).toEqual(['/story/chunks/a.js']);
    expect(read.lazyDeps).toEqual({ '/story/chunks/V.js': ['/story/chunks/d3.js'] });
    expect(read.mermaid).toEqual({ flowchart: ['/story/chunks/flow.js'] });
  });
});
