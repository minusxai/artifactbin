/**
 * GET /api/server — WHO THIS DEPLOYMENT IS.
 *
 * One deployment answers at more than one hostname; nothing on the wire said
 * so, and a client comparing origins as strings treated the two as different
 * servers. This endpoint is the only place that says otherwise, so it has two
 * jobs and no others: answer the CONFIGURED canonical origin (never the origin
 * the request happened to arrive on — that is what would let an alias declare
 * itself canonical), and answer the operator's alias list.
 *
 * Public, unauthenticated, cacheable: a client must be able to read it before
 * it has any credential, and must never send one to get it.
 */
import { describe, expect, it } from 'vitest';
import { request } from '@/__tests__/harness';
import { vi } from 'vitest';

// Hoisted with the mock factory: `@/__tests__/harness` reads config while importing.
const settings = vi.hoisted(() => ({ base: 'https://app.example.com', aliases: [] as readonly string[] }));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  get PUBLIC_BASE_URL() { return settings.base; },
  get ALIAS_ORIGINS() { return settings.aliases; },
}));

const { GET } = await import('@/app/api/server/route');
const { parseAliasOrigins } = await import('@/lib/config');

describe('GET /api/server', () => {
  it('answers the configured origin and aliases, publicly and cacheably', async () => {
    settings.base = 'https://app.example.com';
    settings.aliases = ['https://example.com'];
    const response = await GET(request('/api/server'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ origin: 'https://app.example.com', aliases: ['https://example.com'] });
    expect(response.headers.get('cache-control')).toMatch(/public/);
  });

  it('names the CONFIGURED origin, never the one the request arrived on', async () => {
    settings.base = 'https://app.example.com';
    settings.aliases = ['https://example.com'];
    const response = await GET(new Request('https://example.com/api/server', { headers: { host: 'example.com' } }));
    expect(await response.json()).toEqual({ origin: 'https://app.example.com', aliases: ['https://example.com'] });
  });

  it('answers with no aliases when the setting is unset, and never repeats its own origin', async () => {
    settings.base = 'https://app.example.com';
    settings.aliases = [];
    expect(await (await GET(request('/api/server'))).json()).toEqual({ origin: 'https://app.example.com', aliases: [] });
    settings.aliases = ['https://app.example.com', 'https://example.com'];
    expect(await (await GET(request('/api/server'))).json()).toEqual({ origin: 'https://app.example.com', aliases: ['https://example.com'] });
  });

  it('reads a configured base URL that carries a path as its origin alone', async () => {
    settings.base = 'https://app.example.com/base/';
    settings.aliases = [];
    expect(await (await GET(request('/api/server'))).json()).toEqual({ origin: 'https://app.example.com', aliases: [] });
  });
});

describe('APP__ALIAS_ORIGINS', () => {
  it('is a comma-separated list of origins, trimmed and de-duplicated', () => {
    expect(parseAliasOrigins(undefined)).toEqual([]);
    expect(parseAliasOrigins('')).toEqual([]);
    expect(parseAliasOrigins('   ')).toEqual([]);
    expect(parseAliasOrigins('https://example.com, https://www.example.com'))
      .toEqual(['https://example.com', 'https://www.example.com']);
    expect(parseAliasOrigins('https://example.com/,https://example.com')).toEqual(['https://example.com']);
    expect(parseAliasOrigins('http://localhost:3030')).toEqual(['http://localhost:3030']);
  });

  it('refuses a malformed setting rather than serving half a list', () => {
    for (const bad of [
      'https://example.com/path',
      'https://example.com?a=1',
      'https://user:pw@example.com',
      'http://example.com',
      'ftp://example.com',
      'example.com',
      'https://example.com,,https://other.example.com',
    ]) expect(() => parseAliasOrigins(bad), bad).toThrow(/APP__ALIAS_ORIGINS/);
  });
});
