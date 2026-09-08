import {expect,it,vi} from 'vitest';
import {loadConfig} from '../src/config';
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

it('warns and ignores even malformed retired settings instead of selecting a second authority',()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const config=loadConfig({APP__UPSTREAM_URL:'http://app:3000',CONTRACT__ACTOR_SECRET:'s'.repeat(32),APP__PUBLIC_BASE_URL:'https://example.test',APP__CONTROLS_ORIGIN:'not an origin'});
    expect(config.controlsOrigin).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retired and ignored'));
  }finally{warn.mockRestore();}
});
