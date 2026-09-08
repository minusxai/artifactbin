import {describe,it,expect,vi} from 'vitest';
import {wrapGatePage,sameGateFrame} from '../lib/gate-browser.mjs';
import {openMenu} from '../lib/reveal-chrome.mjs';
describe('main-world gate selectors',()=>{
 it('addresses native CSS and accessible selectors through the main-world identity engine',async()=>{
  const locator={getByRole:vi.fn(),locator:vi.fn()};
  const page={locator:vi.fn(()=>locator),getByRole:vi.fn(()=>locator),click:vi.fn(),mainFrame:vi.fn()};
  const wrapped=wrapGatePage(page);
  expect(sameGateFrame(page,wrapped)).toBe(true);expect(sameGateFrame({},wrapped)).toBe(false);
  wrapped.locator('button');expect(page.locator).toHaveBeenCalledWith('button >> mx-main=');
  wrapped.getByRole('button',{name:'Open menu'});expect(locator.locator).toHaveBeenCalledWith('mx-main=');
  expect(page.getByRole).toHaveBeenCalledWith('button',{name:'Open menu'});
  await wrapped.click('button');expect(page.click).toHaveBeenCalledWith('button >> mx-main=');
 });
});
it('reports safe chrome diagnostics while preserving the failed click as the cause',async()=>{
 const cause=new Error('Timeout');const page={locator:()=>({first:()=>({click:async()=>{throw cause;}})}),evaluate:vi.fn(async()=>({readyState:'complete',trustedRoots:0}))};
 await expect(openMenu(page,{timeout:10})).rejects.toMatchObject({cause,message:expect.stringContaining('trustedRoots')});
});
