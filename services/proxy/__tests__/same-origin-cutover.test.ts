import {expect,it} from 'vitest';
import {createProxy} from '../src/parts';
import {testProxyOptions} from './helpers';

/** A retired deployment setting must never silently select split authority. */
it('keeps the main origin authoritative even when the retired controls setting remains in deployment env',async()=>{
  const main='https://example.test';
  const options=await testProxyOptions();
  const proxy=createProxy({...options,
    env:{...options.env,APP__PUBLIC_BASE_URL:main,APP__CONTROLS_ORIGIN:'https://i.example.test'},
    sessions:{resolve:async()=>({userId:'cutover-user'})},
    upstream:async(_request,actor)=>Response.json(actor),
  });
  const response=await proxy.request(main+'/api/my/artifacts',{
    method:'POST',headers:{origin:main,'x-artifactbin-csrf':'1','sec-fetch-site':'same-origin'},
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({credential:'session',userId:'cutover-user'});
  expect((await proxy.request(main+'/api/my/artifacts',{
    method:'POST',headers:{origin:'https://i.example.test','x-artifactbin-csrf':'1','sec-fetch-site':'same-site'},
  })).status).toBe(403);
});
