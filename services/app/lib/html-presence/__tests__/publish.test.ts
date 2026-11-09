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
 expect(decodePresenceMessage(sent[0]!,'7')).toEqual({id:(result as {id:string}).id,colorId:expect.stringMatching(/^[a-f0-9]{64}$/),label:'@u1',revision:'7',seen:1234,cursor:{nodeId:'p',x:.5,y:.5},selection:null});
 const guest=await publishPresence({userId:null,tokenId:null},{version:7},{session,revision:'7'},ports(sent));
 expect(guest).not.toEqual(result);expect(decodePresenceMessage(sent[1]!,'7')).toMatchObject({label:'Guest'});
});
it('announces a departure for an invisible reader, drops a report from a version behind, and refuses a future revision or malformed session',async()=>{
 const sent:string[]=[];
 const result=await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'7',visible:false},ports(sent));
 expect(decodePresenceMessage(sent[0]!,'7')).toEqual({id:(result as {id:string}).id,gone:true});
 // A page still drawing the version before is answered (it reports again on the new one) and nothing is broadcast.
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'6',visible:true},ports(sent))).toEqual({id:(result as {id:string}).id});
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},{session,revision:'8'},ports(sent))).toBeNull();
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},{session:'short',revision:'7'},ports(sent))).toBeNull();
 expect(await publishPresence({userId:'u1',tokenId:null},{version:7},null,ports(sent))).toBeNull();
 expect(sent).toHaveLength(1);
});

it('uses stable server account color across tabs while keeping tab ids and guests distinct',async()=>{
 const sent:string[]=[],input={session,revision:'7',colorId:'forged'};
 await publishPresence({userId:'u1'},{version:7},input,ports(sent));
 await publishPresence({userId:'u1'},{version:7},{...input,session:session.replace(/1$/,'2')},{...ports(sent),label:async()=> 'Renamed'});
 await publishPresence({userId:'u2'},{version:7},input,ports(sent));
 await publishPresence({userId:null},{version:7},input,ports(sent));
 await publishPresence({userId:null},{version:7},{...input,session:session.replace(/1$/,'2')},ports(sent));
 const entries=sent.map(payload=>JSON.parse(payload));
 expect(entries[0].colorId).toMatch(/^[a-f0-9]{64}$/);
 expect(entries[0].colorId).toBe(entries[1].colorId);expect(entries[0].id).not.toBe(entries[1].id);
 expect(entries[0].colorId).not.toBe(entries[2].colorId);expect(entries[3].colorId).not.toBe(entries[4].colorId);
 expect(decodePresenceMessage(sent[0]!,'7')).toHaveProperty('colorId',entries[0].colorId);
});
