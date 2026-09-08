import {describe, expect, it, vi} from 'vitest';
import {loginViaEmail,readBrowserSession} from '../lib/mail-login.mjs';
const pageFor = session => ({
  locator:vi.fn(()=>({count:vi.fn(async()=>0),evaluate:vi.fn(async()=>session)})),
  getByLabel:vi.fn(()=>({waitFor:vi.fn(),fill:vi.fn(),click:vi.fn()})),
  goto:vi.fn(), waitForSelector:vi.fn(), fill:vi.fn(), click:vi.fn(), waitForURL:vi.fn(async()=>{}),
  // An async predicate resolving false is still a Promise when a polling
  // loop tests its truthiness. Never accept completion as proof of identity.
  waitForFunction:vi.fn(async()=>false),
  evaluate:vi.fn(async()=>session), url:()=> 'https://i.example.test/',
});
describe('gate login verification',()=>{
  it('reads the validated session with exact main-origin browser headers',async()=>{
    const session={kind:'account',user:{email:'gate@example.com'}};
    const get=vi.fn(async()=>({ok:()=>true,json:async()=>session}));
    expect(await readBrowserSession({request:{get}},'http://localhost:5802/account')).toBe(session);
    expect(get).toHaveBeenCalledWith('http://localhost:5802/api/page/session',{headers:expect.objectContaining({origin:'http://localhost:5802','sec-fetch-site':'same-origin','x-artifactbin-csrf':'1'})});
  });
  it('refuses a completed browser poll that did not establish the expected account',async()=>{
    const page=pageFor({kind:'none',user:null});
    await expect(loginViaEmail(page,'https://example.test',{lastCode:()=> '123456'},'mxmx_test@example.com')).rejects.toThrow(/session/);
  });
  it('checks the resolved account, not a truthy Promise',async()=>{
    const email='mxmx_test@example.com', page=pageFor({kind:'account',user:{email}});
    expect(await loginViaEmail(page,'https://example.test',{lastCode:()=> '123456'},email)).toBe(email);
    expect(page.locator).toHaveBeenCalledWith('body');
    expect(page.waitForFunction).not.toHaveBeenCalled();
  });
});
