import {afterAll, beforeAll, expect, it} from 'vitest';
import {createProxy} from '../src/parts';
import {testDb, testProxyOptions} from './helpers';

const main='https://example.test', controls='https://i.example.test';
let proxy:ReturnType<typeof createProxy>;
beforeAll(async()=>{
  const options=await testProxyOptions();
  proxy=createProxy({...options,env:{...options.env,APP__PUBLIC_BASE_URL:main,APP__CONTROLS_ORIGIN:controls}});
});
afterAll(async()=>{await testDb().pg().close();});

it('advertises a main-domain consent page without moving token exchange or issuer',async()=>{
  const response=await proxy.request(main+'/.well-known/oauth-authorization-server');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({issuer:main,authorization_endpoint:main+'/oauth/authorize',token_endpoint:main+'/oauth/token'});
});

it('renders consent errors directly on main without any controls frame',async()=>{
  const response=await proxy.request(main+'/oauth/authorize?client_id=unknown');
  expect(response.status).toBe(400);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('cache-control')).toContain('no-store');
  const html=await response.text();
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain(controls+'/controls/');
  expect(html).toContain('Unknown client');
  expect(html).not.toContain('name="approval"');
  expect(html).not.toContain('<form');
});
