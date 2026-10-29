import {expect,it} from 'vitest';
import {decodePresenceMessage,encodePresenceMessage} from '../message';
const id='b'.repeat(64);
it('round-trips a viewer and a departure through the one wire format the publisher and the room share',()=>{
 const viewer={id,label:'Reader',revision:'3',seen:10,cursor:{nodeId:'p',x:.5,y:.25},selection:null};
 expect(decodePresenceMessage(encodePresenceMessage(viewer),'3')).toEqual(viewer);
 expect(decodePresenceMessage(encodePresenceMessage({id,gone:true}),'3')).toEqual({id,gone:true});
});
it('refuses another revision, foreign ids, oversized labels, unbounded geometry and malformed payloads',()=>{
 const viewer={id,label:'Reader',revision:'3',seen:10,cursor:{nodeId:'p',x:.5,y:.25},selection:null};
 expect(decodePresenceMessage(encodePresenceMessage(viewer),'4')).toBeNull();
 expect(decodePresenceMessage(JSON.stringify({...viewer,id:'not-a-key'}),'3')).toBeNull();
 expect(decodePresenceMessage(JSON.stringify({...viewer,label:'x'.repeat(101)}),'3')).toBeNull();
 expect(decodePresenceMessage(JSON.stringify({...viewer,seen:'later'}),'3')).toBeNull();
 expect(decodePresenceMessage(JSON.stringify({...viewer,cursor:{nodeId:'p',x:9,y:0},extra:'secret'}),'3')).toEqual({...viewer,cursor:null});
 expect(decodePresenceMessage('{',  '3')).toBeNull();expect(decodePresenceMessage('null','3')).toBeNull();
});
