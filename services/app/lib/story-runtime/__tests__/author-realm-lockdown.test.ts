import {it,expect} from 'vitest';
import {runInNewContext} from 'node:vm';
import {AUTHOR_REALM_LOCKDOWN} from '../author-realm-lockdown';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../author-script-bootstrap';
it('removes WebRTC constructors immutably before author execution',()=>{
 const realm:Record<string,unknown>={RTCPeerConnection:function(){},webkitRTCPeerConnection:function(){},mozRTCPeerConnection:function(){}};
 runInNewContext(AUTHOR_REALM_LOCKDOWN,realm);
 for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection']){
  expect(Object.getOwnPropertyDescriptor(realm,name)).toMatchObject({value:undefined,writable:false,configurable:false});
  expect(()=>Object.defineProperty(realm,name,{value:function(){}})).toThrow();
 }
});
it('includes the denial in the actual author bootstrap, not just the helper',()=>{
 expect(AUTHOR_SCRIPT_BOOTSTRAP).toContain(AUTHOR_REALM_LOCKDOWN);
 expect(AUTHOR_SCRIPT_BOOTSTRAP.indexOf(AUTHOR_REALM_LOCKDOWN)).toBeLessThan(AUTHOR_SCRIPT_BOOTSTRAP.indexOf("message.type === 'run'"));
});
