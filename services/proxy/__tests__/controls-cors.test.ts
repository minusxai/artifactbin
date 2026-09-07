import {expect,it} from 'vitest';
import {Hono} from 'hono';
import {inProcess} from '@artifactbin/utils';
import {createProxy} from '../src/parts';
import {testProxyOptions} from './helpers';

it('does not retain the legacy credentialed main-host CORS write path', async () => {
  let writes = 0;
  const upstream = new Hono();
  upstream.post('/api/my/probe', c => {writes++; return c.text('saved');});
  const opts = await testProxyOptions();
  const proxy = createProxy({...opts, upstream:inProcess(upstream), env:{...opts.env,APP__PUBLIC_BASE_URL:'https://artifactbin.test',APP__CONTROLS_ORIGIN:'https://i.artifactbin.test'},sessions:{resolve:async () => ({userId:'owner'})}});
  const preflight = await proxy.request('https://artifactbin.test/api/my/probe', {method:'OPTIONS',headers:{Origin:'https://i.artifactbin.test','Access-Control-Request-Method':'POST'}});
  expect(preflight.status).toBe(403);
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  expect((await proxy.request('https://artifactbin.test/api/my/probe', {method:'POST',headers:{Origin:'https://i.artifactbin.test'}})).status).toBe(403);
  const accepted = await proxy.request('https://i.artifactbin.test/api/my/probe', {method:'POST',headers:{Origin:'https://i.artifactbin.test','x-artifactbin-csrf':'1'}});
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('access-control-allow-credentials')).toBeNull();
  const refused = await proxy.request('https://i.artifactbin.test/api/my/probe', {method:'POST',headers:{Origin:'https://evil.artifactbin.test','Sec-Fetch-Site':'same-site'}});
  expect(refused.status).toBe(403);
  expect(refused.headers.get('access-control-allow-origin')).toBeNull();
  expect(writes).toBe(1);
});
