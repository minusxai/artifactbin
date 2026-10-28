/**
 * AN OLD CLI IS TOLD IT IS RETIRED, ON EVERY COMMAND (CLI__RETIREMENT=on).
 *
 * The requests below are the ones afbin 0.5.55 makes (services/cli/src/http.ts on v2-final): every API call carries
 * `Authorization`, `X-Artifactbin-Protocol: 3` and `User-Agent: afbin/0.5.55`; 0.3.x and 0.4.x sent protocol 2. The
 * answer must be the shape those CLIs print (`cli_retired: The artifactbin CLI is retired.` and the fix under it), and
 * nothing else may change: browsers, the author skill's client (`native-author-v1`), alias discovery at /api/server
 * and the release pointer `afbin update` reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '../app';
import { CLI_RETIREMENT_VERSION, overrideConfig, resetConfigOverrides } from '@/lib/platform/config';

const ORIGIN = 'https://app.artifactbin.example';
const app = () => createAppServer({ indexHtml: async () => '<main>app shell</main>' });
const oldCli = (version: string, protocol: string, extra: Record<string, string> = {}) => ({
  Authorization: 'Bearer stale-saved-token', 'X-Artifactbin-Protocol': protocol, 'User-Agent': `afbin/${version}`, ...extra,
});
const on = () => overrideConfig({ publicBaseUrl: ORIGIN, aliasOrigins: ['https://app.artefactbin.example'] }, { CLI__RETIREMENT: 'on' });

afterEach(() => resetConfigOverrides());

describe('CLI retirement', () => {
  it('answers every request an old CLI makes with the refusal it prints, before any sign-in decision', async () => {
    on();
    const server = app();
    const requests: Array<[string, RequestInit]> = [
      ['/api/artifacts?limit=1', { headers: oldCli('0.5.55', '3') }],
      ['/api/artifacts/abc123', { headers: oldCli('0.5.55', '3', { 'X-Artifactbin-Account': 'usr_1' }) }],
      ['/api/artifacts', { method: 'POST', headers: oldCli('0.5.55', '3', { 'Content-Type': 'application/json' }), body: '{"html":"<p>x</p>"}' }],
      ['/api/artifacts/preflight', { method: 'POST', headers: oldCli('0.5.55', '3', { 'Content-Type': 'application/json', 'X-Artifactbin-Dry-Run': '1' }), body: '{}' }],
      ['/a/abc123/export', { headers: oldCli('0.5.55', '3', { 'X-Artifactbin-Export-Delivery': 'redirect' }) }],
      ['/api/artifacts?limit=1', { headers: oldCli('0.4.12', '2') }],
      ['/api/artifacts?limit=1', { headers: oldCli('0.3.21', '2') }],
    ];
    for (const [path, init] of requests) {
      const res = await server.request(path, init);
      expect(res.status, path).toBe(410);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('no-store');
      // 0.3.x compares this header on every response; it would print a generic protocol mismatch instead.
      expect(res.headers.get('x-artifactbin-protocol')).toBeNull();
      expect(res.headers.get('x-artifactbin-cli-version')).toBeNull();
      expect(await res.json()).toEqual({
        error: 'cli_retired',
        message: 'The artifactbin CLI is retired.',
        hint: `Run \`afbin update\` (or \`npx @afbin/cli@latest\`), then use the author skill: ${ORIGIN}/skills/artifactbin.zip`,
        skill_url: `${ORIGIN}/skills/artifactbin.zip`,
      });
    }
  });

  it('keeps alias discovery and the release pointer readable, so the CLI resolves the canonical origin and `afbin update` installs the retirement release', async () => {
    on();
    const server = app();
    const identity = await server.request('/api/server', { headers: { Accept: 'application/json', 'User-Agent': 'afbin/0.5.55' } });
    expect(identity.status).toBe(200);
    expect(await identity.json()).toEqual({ origin: ORIGIN, aliases: ['https://app.artefactbin.example'] });
    const pointer = await server.request('/chat/release.json', { headers: { Accept: 'application/json' } });
    expect(pointer.status).toBe(200);
    expect((await pointer.json() as { version: string }).version).toBe(CLI_RETIREMENT_VERSION);
  });

  it('leaves browsers, the author skill and the hosted browser alone', async () => {
    on();
    const server = app();
    const skill = await server.request('/api/no-such-route', { headers: { 'X-Artifactbin-Protocol': 'native-author-v1', Origin: ORIGIN } });
    expect(skill.status).toBe(404);
    expect((await skill.json() as { error: string }).error).toBe('not_found');
    const browser = await server.request('/getting-started', { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0.0.0 Safari/537.36' } });
    expect(browser.status).toBe(200);
    expect(await browser.text()).toContain('app shell');
    for (const protocol of ['obsolete', '', '0', '3a']) {
      const res = await server.request('/api/no-such-route', { headers: { 'X-Artifactbin-Protocol': protocol } });
      expect(res.status, JSON.stringify(protocol)).toBe(404);
    }
  });

  it('changes nothing while the switch is off', async () => {
    overrideConfig({ publicBaseUrl: ORIGIN }, { CLI__RETIREMENT: undefined });
    const res = await app().request('/api/no-such-route', { headers: oldCli('0.5.55', '3') });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('not_found');
  });
});
