/**
 * Code view's extras, loaded on demand (lib/offline/extras): one SRI-pinned
 * script from the file's own origin, only when asked, and a retry after a
 * failure. The real load, under the file's CSP, runs in
 * scripts/gate-offline-file.mjs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createExtrasLoader, extrasScriptUrl, type OfflineExtras } from '../extras';

const SRC = 'https://app.artifactbin.dev/offline/extras-0123456789abcdef.js';
const INTEGRITY = 'sha384-abc';
const scripts = () => [...document.head.querySelectorAll('script[data-afbin-extras]')] as HTMLScriptElement[];

afterEach(() => {
  document.head.replaceChildren();
  delete globalThis.__afbinExtras;
});

describe('extrasScriptUrl', () => {
  it('puts the extras on the file\'s own origin, and nowhere else', () => {
    const extras = { path: '/offline/extras-0123456789abcdef.js', integrity: INTEGRITY };
    expect(extrasScriptUrl('https://app.artifactbin.dev', extras)).toBe(SRC);
    expect(extrasScriptUrl('http://localhost:6001/', extras)).toBe('http://localhost:6001/offline/extras-0123456789abcdef.js');
    expect(extrasScriptUrl('https://app.artifactbin.dev', { ...extras, path: '//evil.example/x.js' })).toBeNull();
    expect(extrasScriptUrl('file:///tmp/x.html', extras)).toBeNull();
    expect(extrasScriptUrl('https://app.artifactbin.dev', null)).toBeNull();
  });
});

describe('createExtrasLoader', () => {
  it('requests nothing until asked, then inserts ONE pinned script', () => {
    const loader = createExtrasLoader(SRC, INTEGRITY);
    expect(scripts()).toHaveLength(0);
    expect(loader.state()).toBe('idle');
    void loader.load();
    void loader.load();
    expect(scripts()).toHaveLength(1);
    const [script] = scripts();
    expect(script!.src).toBe(SRC);
    expect(script!.integrity).toBe(INTEGRITY);
    expect(script!.crossOrigin).toBe('anonymous');
    expect(loader.state()).toBe('loading');
  });

  it('is ready once the script has set the global', async () => {
    const loader = createExtrasLoader(SRC, INTEGRITY);
    const seen: string[] = [];
    loader.subscribe(() => seen.push(loader.state()));
    const loaded = loader.load();
    globalThis.__afbinExtras = { sourceEditor: {} } as OfflineExtras;
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(loaded).resolves.toBeUndefined();
    expect(seen).toEqual(['loading', 'ready']);
    await loader.load();
    expect(scripts()).toHaveLength(1);
  });

  it('fails without a connection, drops the script, and tries again when asked', async () => {
    const loader = createExtrasLoader(SRC, INTEGRITY);
    const first = loader.load();
    scripts()[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('The rich code editor needs a connection the first time. Using the plain editor.');
    expect(loader.state()).toBe('failed');
    expect(scripts()).toHaveLength(0);
    void loader.load();
    expect(scripts()).toHaveLength(1);
    expect(loader.state()).toBe('loading');
  });

  it('treats a script that ran but set nothing (a wrong file) as a failure', async () => {
    const loader = createExtrasLoader(SRC, INTEGRITY);
    const loaded = loader.load();
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(loaded).rejects.toThrow();
    expect(loader.state()).toBe('failed');
  });

  it('fails at once, requesting nothing, for a file that names no extras', async () => {
    const loader = createExtrasLoader(null, null);
    await expect(loader.load()).rejects.toThrow();
    expect(scripts()).toHaveLength(0);
    expect(loader.state()).toBe('failed');
  });
});
