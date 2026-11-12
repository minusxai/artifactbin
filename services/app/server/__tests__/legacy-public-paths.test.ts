/** Current files and short links keep their contracts without retired URL aliases. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyPath, emailLinkPath } from '@artifactbin/contracts';
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
describe('supported public paths without aliases', () => {
  it('serves current public files with CORS and HEAD, while old paths do not serve their bytes', async () => {
    const server = app();
    for (const [current, retired] of [
      ['/af/lib/vega-6.3.1/index.js', '/libraries/vega-6.3.1/index.js'],
      ['/af/geojson/world.json', '/geojson/world.json'],
      ['/af/fonts/inter-latin-standard-normal.2c295d99.woff2', '/fonts/inter-latin-standard-normal.2c295d99.woff2'],
    ]) {
      const response = await server.request(current!);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const source = await response.text();
      expect((await server.request(current!, {method:'HEAD'})).status).toBe(200);
      const old = await server.request(retired!);
      expect(await old.text(), retired).not.toBe(source);
      expect(old.headers.get('access-control-allow-origin'), retired).toBeNull();
    }
  });

  it('keeps current person and email links while removing old link redirects and effects', async () => {
    const server = app(), user = await createUser({email:'mxmx_test_links@example.com'});
    await (await getDb()).query('UPDATE users SET username=$2 WHERE id=$1', [user.id, 'current_reader']);
    expect((await server.request(`/api/people/${user.id}`)).headers.get('location')).toBe('/@current_reader');
    const clicks: string[] = [], none = {invitations:false,comments:false,activity:false};
    setNotificationDelivery({preferences:async()=>none,updatePreferences:async()=>none,click:async id=>{clicks.push(id);return '/a/Abc123';}});
    try {
      expect((await server.request(emailLinkPath('d1'))).status).toBe(302);
      for (const retired of [`/people/${user.id}`, '/email/d1', '/workspace/Abc123', '/api/workspace/Abc123']) {
        expect((await server.request(retired)).headers.get('location'), retired).toBeNull();
      }
      expect(clicks).toEqual(['d1']);
    } finally { setNotificationDelivery(undefined); }
  });

  it('has no runtime alias routes while keeping current runtime modules', async () => {
    const server = app();
    for (const current of ['/af/core.js','/af/apollo.js','/af/reader.js','/af/native-regions.js']) {
      const response = await server.request(current);
      expect(response.status,current).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    for (const retired of ['/af/v1/core.js','/af/v1/apollo/'+'a'.repeat(64),'/af/v1/reader/'+'a'.repeat(64),'/af/regions.js']) {
      expect((await server.request(retired)).status,retired).toBe(404);
    }
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
      if (trees) expect(['fixed'], `${route} serves a tree outside /af/`).toContain(kind);
      else expect(['fixed', 'screen'], route).toContain(kind);
    }
  });

  it('keeps public/ to the directories and the two root files server/public-files mounts', () => {
    const mounted = ['favicon.ico', 'fonts', 'geojson', 'img', 'libraries', 'og.png'];
    // Tracked files (the build-generated directories are gitignored and written by their own scripts).
    for (const file of execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' }).split('\n').filter(Boolean)) expect(mounted, `${file} is served by nothing`).toContain(file.split('/')[1]);
  });
});
