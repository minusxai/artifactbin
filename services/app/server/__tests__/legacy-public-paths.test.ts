/**
 * EVERY OLD ADDRESS ANSWERS EXACTLY AS ITS NEW ONE (contracts legacy-public-paths), and nothing else old exists.
 *
 * Each table row is requested at both addresses through the whole app: same status, same body bytes, same headers
 * (a timing header aside), for a hit, a miss and a HEAD; the link rows (people, email, workspace) the same redirect.
 * The second half keeps the scheme from eroding: no route or static tree serves a root-level prefix of files outside
 * `/af/` except the table's rows and the fixed paths the URL map names, and public/ holds only what is mounted.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LEGACY_PUBLIC_PATHS, classifyPath, emailLinkPath } from '@artifactbin/contracts';
import { setNotificationDelivery } from '@/lib/notifications';
import { useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createAppServer } from '../app';

useAppHarness();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-public-'));
const put = (file: string, body: string) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), body); };
put('libraries/vega-6.3.1/index.js', 'export const vega = 1;');
put('geojson/world.json', '{"type":"FeatureCollection","features":[]}');
put('fonts/inter-latin-standard-normal.2c295d99.woff2', 'wOF2-bytes');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const app = () => createAppServer({ indexHtml: async () => '<html><head></head><body><div id="root"></div></body></html>', publicDir: dir });
/** Everything a client can observe of an answer, minus the per-request timing. */
async function observed(res: Response) {
  const headers = Object.fromEntries([...res.headers].filter(([name]) => !['server-timing', 'date'].includes(name)));
  return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()).toString('base64') };
}
async function same(oldPath: string, newPath: string, init?: RequestInit) {
  const server = app();
  const [before, after] = await Promise.all([server.request(oldPath, init), server.request(newPath, init)]);
  const left = await observed(before), right = await observed(after);
  expect(left, `${oldPath} answers as ${newPath}`).toEqual(right);
  return left;
}

describe('old public-file addresses', () => {
  const files: Record<string, string> = { '/libraries/': 'vega-6.3.1/index.js', '/geojson/': 'world.json', '/fonts/': 'inter-latin-standard-normal.2c295d99.woff2' };
  for (const row of LEGACY_PUBLIC_PATHS.filter((r) => r.kind === 'file')) {
    it(`${row.from} answers as ${row.to}: hit, HEAD and miss`, async () => {
      const file = files[row.from];
      expect(file, `a fixture for ${row.from}`).toBeDefined();
      const hit = await same(row.from + file, row.to + file);
      expect(hit.status).toBe(200);
      expect(hit.headers['access-control-allow-origin']).toBe('*');
      expect((await same(row.from + file, row.to + file, { method: 'HEAD' })).status).toBe(200);
      expect((await same(row.from + 'missing-file.json', row.to + 'missing-file.json')).status).toBe(404);
    });
  }
});

describe('old link addresses', () => {
  it('/people/<id> redirects exactly as /api/people/<id>', async () => {
    const user = await createUser({ email: 'mxmx_test_legacy_people@example.com' });
    await (await getDb()).query('UPDATE users SET username=$2 WHERE id=$1', [user.id, 'legacy_reader']);
    const answer = await same(`/people/${user.id}`, `/api/people/${user.id}`);
    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe('/@legacy_reader');
    expect((await same('/people/missing', '/api/people/missing')).status).toBe(404);
  });

  it('/email/<id> records the click and redirects exactly as the address emailLinkPath writes', async () => {
    const clicks: string[] = [];
    const none = { invitations: false, comments: false, activity: false };
    setNotificationDelivery({ preferences: async () => none, updatePreferences: async () => none, click: async (id) => { clicks.push(id); return '/a/Abc123'; } });
    try {
      const answer = await same('/email/d1', emailLinkPath('d1'));
      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe('/a/Abc123');
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.headers['referrer-policy']).toBe('no-referrer');
      expect(clicks).toEqual(['d1', 'd1']);
    } finally { setNotificationDelivery(undefined); }
  });

  it('/workspace/<id> answers exactly as /api/workspace/<id>', async () => {
    expect((await same('/workspace/Abc123', '/api/workspace/Abc123')).status).toBeGreaterThanOrEqual(300);
    expect((await same('/workspace/bad', '/api/workspace/bad')).status).toBe(404);
  });
});

describe('no other root-level public-file prefix', () => {
  it('registers prefix routes only under the map\'s prefixes, a legacy row or a fixed path', () => {
    const allowed = (route: string) => route === '*' || route === '/*' || route.startsWith('/api') || route.startsWith('/af/') || route.startsWith('/a/') || route.startsWith('/:user');
    for (const { path: route } of app().routes) {
      if (allowed(route)) continue;
      const trees = /\/\*$|\{\.[+*]\}\??$/.test(route);
      const sample = route.replace(/\/\*$/, '/x').replace(/:\w+\{\.[+*]\}\??/, 'x/y').replace(/:\w+/g, 'Abc123');
      const kind = classifyPath(sample);
      if (trees) expect(['fixed', 'legacy'], `${route} serves a tree outside /af/`).toContain(kind);
      else expect(['fixed', 'legacy', 'screen'], route).toContain(kind);
    }
  });

  it('keeps public/ to the directories and the two root files server/public-files mounts', () => {
    const mounted = ['favicon.ico', 'fonts', 'geojson', 'img', 'libraries', 'og.png'];
    // Tracked files (the build-generated directories are gitignored and written by their own scripts).
    for (const file of execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' }).split('\n').filter(Boolean)) expect(mounted, `${file} is served by nothing`).toContain(file.split('/')[1]);
  });
});
