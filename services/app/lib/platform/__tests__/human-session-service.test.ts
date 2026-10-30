import {afterEach,expect,it,vi} from 'vitest';
import {HUMAN_SESSION_LIVE_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it('split app composition uses the configured auth-owner client ahead of local fallbacks',async()=>{
 vi.resetModules();vi.stubEnv('AUTH__SERVICE_URL','http://auth-owner');vi.stubEnv('INTERNAL__SERVICE_SECRET','test-service-secret');
 let active=true;
 const send=vi.fn(async(r:Request)=>{
  expect(r.url).toBe(`http://auth-owner${HUMAN_SESSION_LIVE_PATH}`);
  expect(r.headers.get(SERVICE_AUTH_HEADER)).toBe('test-service-secret');expect(await r.json()).toEqual({sessionId:'session',userId:'user'});
  return Response.json({live:active});
 });vi.stubGlobal('fetch',send);
 const {services,setServices}=await import('../services');
 setServices({humanSessions:{live:async()=>false}});
 expect(await services().humanSessions.live('session','user')).toBe(true);
 active=false;expect(await services().humanSessions.live('session','user')).toBe(false);
 expect(send).toHaveBeenCalledTimes(2);
});
it('refuses split auth transport configuration without a service credential',async()=>{
 vi.resetModules();vi.stubEnv('AUTH__SERVICE_URL','http://auth-owner');vi.stubEnv('INTERNAL__SERVICE_SECRET','');
 await expect(import('../services')).rejects.toThrow('requires a service secret');
});
