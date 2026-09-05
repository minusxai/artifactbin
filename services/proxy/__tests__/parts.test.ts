/** THE PARTS ORDER IS THE CONTRACT: a literal, forward last; a downstream overrides by name and never guesses position. */
import { describe, expect, it } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { BROWSER_MINT_HEADERS, policyFile, testProxyOptions } from './helpers';

describe('proxyParts', () => {
  it('names are exactly ["session","rateLimit","loginRoutes","oauthRoutes","forwardedHeaders","forward"] in that order', async () => {
    expect((await proxyParts(await testProxyOptions())).map((p) => p.name)).toEqual(['session', 'rateLimit', 'loginRoutes', 'oauthRoutes', 'forwardedHeaders', 'forward']);
  });
  it('forward is LAST — positional ownership replaces the hand-kept prefix list', async () => {
    const parts = await proxyParts(await testProxyOptions());
    expect(parts.at(-1)?.name).toBe('forward');
  });
  it('overriding rateLimit with null actually removes the rate-limit verdict', async () => {
    const options = await testProxyOptions({ env: { PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_1.yml') } });
    const parts = await proxyParts(options);
    const limited = assemble(parts);
    expect((await limited.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).not.toBe(429);
    expect((await limited.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).toBe(429);

    const withoutDoor = assemble(await proxyParts(await testProxyOptions({ env: options.env })), { rateLimit: null });
    expect((await withoutDoor.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).not.toBe(429);
    expect((await withoutDoor.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).not.toBe(429);
  });
  it('assemble refuses two parts with one name over the real list', async () => {
    const parts = await proxyParts(await testProxyOptions());
    expect(() => assemble([...parts, parts[0]])).toThrow(/duplicate part "session"/);
  });
});
