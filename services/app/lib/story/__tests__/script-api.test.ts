import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { artifactApiScript } from '../script-api';

function setup() {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const scope = { window: {} as { artifact: { resolve(ref: string): Promise<string>; library(name: string): Promise<unknown> } }, URL, fetch, Map, Error };
  runInNewContext(artifactApiScript({ resolveUrl: 'https://art.test/a/Doc123/resolve', libraries: { three: 'https://art.test/libraries/three-0.185.1/index.js' } }), scope);
  return { api: scope.window.artifact, fetch };
}

describe('author artifact API', () => {
  it('resolves a ref through only its scoped endpoint, without viewer credentials', async () => {
    const { api, fetch } = setup();
    expect(await api.resolve('ref:Abc123')).toBe('https://art.test/a/Doc123/resolve?ref=ref%3AAbc123');
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { method: 'HEAD', credentials: 'omit', cache: 'no-store' });
  });
  it('rejects missing/private files and does not cache access decisions', async () => {
    const { api, fetch } = setup();
    await api.resolve('ref:Abc123');
    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.resolve('ref:Abc123')).rejects.toThrow('not found');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects URLs and unknown library names without fetching them', async () => {
    const { api, fetch } = setup();
    await expect(api.resolve('https://example.com/file')).rejects.toThrow('ref:');
    await expect(api.library('https://example.com/evil.js')).rejects.toThrow('Unknown library');
    await expect(api.library('constructor')).rejects.toThrow('Unknown library');
    expect(fetch).not.toHaveBeenCalled();
  });
});
