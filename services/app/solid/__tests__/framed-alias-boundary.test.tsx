/* @jsxImportSource solid-js */
import {cleanup,render,screen} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
const loaded=vi.hoisted(()=>({alias:0}));
// Count the route module import: destination behavior remains covered by document-chrome/profile-alias-route.
vi.mock('../pages/ProfileAlias',()=>{loaded.alias++;return {ProfileAliasRoute:()=> <p>Alias resolver</p>};});
vi.mock('../pages/Document',()=>({DocumentPage:()=> <p>Admitted document</p>}));
import {App} from '../App';
import {captureServedFrame,dropServedFrame} from '../lib/served-frame';
import {STORY_FRAMED_ATTR} from '@/lib/islands/contract';
afterEach(async()=>{cleanup();await vi.dynamicImportSettled();dropServedFrame();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function mount(path:string,admitted:boolean){
 window.history.replaceState(null,'',path);
 if(admitted){const frame=document.createElement('div');frame.setAttribute(STORY_FRAMED_ATTR,'');document.body.append(frame);}
 captureServedFrame();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({kind:'none',user:null,onboarded:true})));
 render(()=><App/>);
}
it('uses only server admission for canonical and archived aliases without changing the address',async()=>{
 for(const path of ['/@owner/doc001-title?version=4#section','/@owner/doc002-old']){
  mount(path,true);await screen.findByText('Admitted document');expect(loaded.alias).toBe(0);
  expect(location.pathname+location.search+location.hash).toBe(path);cleanup();dropServedFrame();
 }
});
it('leaves an unadmitted alias to its original resolver even when its id looks valid',async()=>{
 mount('/@owner/doc001-title',false);await screen.findByText('Alias resolver');expect(loaded.alias).toBe(1);
 expect(screen.queryByText('Admitted document')).toBeNull();
});
