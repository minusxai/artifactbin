import {describe, expect, it, vi} from 'vitest';
import {loginViaEmail} from '../lib/mail-login.mjs';
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
