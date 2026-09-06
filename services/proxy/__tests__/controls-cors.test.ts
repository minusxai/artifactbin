import {expect,it} from 'vitest';
import {Hono} from 'hono';
import {inProcess} from '@artifactbin/utils';
import {createProxy} from '../src/parts';
import {testProxyOptions} from './helpers';

it('preflights the trusted controls origin and rejects a cookie write from another same-site origin before forwarding', async () => {
  let writes = 0;
  const upstream = new Hono();
  upstream.post('/probe', c => {writes++; return c.text('saved');});
  const opts = await testProxyOptions();
  const proxy = createProxy({...opts, upstream:inProcess(upstream), env:{...opts.env,APP__PUBLIC_BASE_URL:'https://artifactbin.test',APP__CONTROLS_ORIGIN:'https://i.artifactbin.test'},sessions:{resolve:async () => ({userId:'owner'})}});
  const preflight = await proxy.request('https://artifactbin.test/probe', {method:'OPTIONS',headers:{Origin:'https://i.artifactbin.test','Access-Control-Request-Method':'POST'}});
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('https://i.artifactbin.test');
  const accepted = await proxy.request('https://artifactbin.test/probe', {method:'POST',headers:{Origin:'https://i.artifactbin.test','Sec-Fetch-Site':'same-site'}});
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('access-control-allow-credentials')).toBe('true');
  const refused = await proxy.request('https://artifactbin.test/probe', {method:'POST',headers:{Origin:'https://evil.artifactbin.test','Sec-Fetch-Site':'same-site'}});
  expect(refused.status).toBe(403);
  expect(refused.headers.get('access-control-allow-origin')).toBeNull();
  expect(writes).toBe(1);
});
