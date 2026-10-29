import {expect,it} from 'vitest';
import {publishPresence} from '../publish.server';
import {decodePresenceMessage} from '../message';
const session='00000000-0000-4000-8000-000000000001';
const ports=(sent:string[])=>({label:async(userId:string|null)=>userId?`@${userId}`:null,notify:async(message:string)=>{sent.push(message);},now:()=>1234});
it('publishes a platform-labelled, revision-bound entry under a non-reversible per-tab id',async()=>{
 const sent:string[]=[];
 const result=await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'7',label:'Spoofed',cursor:{nodeId:'p',x:.5,y:.5}},ports(sent));
 expect(result).toMatchObject({id:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(sent).toHaveLength(1);expect(sent[0]).not.toContain(session);
 expect(decodePresenceMessage(sent[0]!,'7')).toEqual({id:(result as {id:string}).id,label:'@u1',revision:'7',seen:1234,cursor:{nodeId:'p',x:.5,y:.5},selection:null});
 const guest=await publishPresence({userId:null,tokenId:null},{version:7},{session,revision:'7'},ports(sent));
 expect(guest).not.toEqual(result);expect(decodePresenceMessage(sent[1]!,'7')).toMatchObject({label:'Guest'});
});
it('announces a departure for an invisible reader and refuses a stale revision or malformed session',async()=>{
 const sent:string[]=[];
 const result=await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'7',visible:false},ports(sent));
 expect(decodePresenceMessage(sent[0]!,'7')).toEqual({id:(result as {id:string}).id,gone:true});
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'6'},ports(sent))).toBeNull();
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},{session:'short',revision:'7'},ports(sent))).toBeNull();
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},null,ports(sent))).toBeNull();
 expect(sent).toHaveLength(1);
});
