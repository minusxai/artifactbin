import {afterEach,describe,it,expect,vi} from 'vitest';
import {connectLocalDocument} from '../browser';
const identity={platformOrigin:'https://platform.example',artifactId:'page123',baseRevision:'1',sourceDigest:'a'.repeat(64)};
afterEach(()=>{document.querySelectorAll('iframe').forEach(frame=>frame.remove());vi.restoreAllMocks();});
describe('local file connection',()=>{
 it('never contacts the platform during private preview or remembered offline mode',()=>{
  for(const mode of [{privatePreview:true},{stayOffline:true}]){
   const states:string[]=[];const connection=connectLocalDocument({win:window,identity,...mode,onState:s=>states.push(s)});
   expect(document.querySelector('iframe')).toBeNull();expect(states).toEqual(['offline']);
   if('privatePreview' in mode){connection.retry();connection.signIn();expect(document.querySelector('iframe')).toBeNull();}
   connection.dispose();
  }
 });
 it('rejects malformed destinations even on explicit retry',()=>{
  const connection=connectLocalDocument({win:window,identity:{...identity,platformOrigin:'javascript:alert(1)'},onState:()=>{}});
  connection.retry();expect(document.querySelector('iframe')).toBeNull();connection.dispose();
 });
 it('connects only to the saved platform and removes the broker on disconnect',()=>{
  const states:string[]=[];const connection=connectLocalDocument({win:window,identity,onState:s=>states.push(s)});
  const frame=document.querySelector('iframe')!;expect(new URL(frame.src).origin).toBe(identity.platformOrigin);expect(frame.src).toContain('/local/connect#nonce=');
  expect(states).toEqual(['connecting']);connection.disconnect();expect(document.querySelector('iframe')).toBeNull();expect(states.at(-1)).toBe('offline');connection.dispose();
 });
});
