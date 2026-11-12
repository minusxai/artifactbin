import {afterEach,expect,it,vi} from 'vitest';
import type {startPortableSession} from '../portable-session';
const harness=vi.hoisted(()=>({start:vi.fn<typeof startPortableSession>()}));
vi.mock('@afbin/portable',()=>({startPortableSession:harness.start}));
let cleanup:(()=>void)|undefined;
afterEach(()=>{cleanup?.();cleanup=undefined;vi.unstubAllGlobals();vi.resetModules();document.head.innerHTML='';document.documentElement.removeAttribute('data-af-private-preview');localStorage.clear();harness.start.mockReset();});
it('exports hosted remoteReadOnly false without promising mutation authority',async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:[],offline:false});const author=await import('../browser-client');expect(author.remoteReadOnly).toBe(false);
});
it('keeps viewer state mutations available while portable remote access is permanently read-only',async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:[],offline:true,initialState:{filter:'all'}});const author=await import('../browser-client');expect(author.remoteReadOnly).toBe(true);const {state}=await import('../browser-state');await state.setState({filter:'mine'});expect(state.getState()).toEqual({filter:'mine'});expect(harness.start).not.toHaveBeenCalled();
});
