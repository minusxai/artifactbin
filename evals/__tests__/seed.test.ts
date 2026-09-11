import { expect, it } from 'vitest';
import { seedDocument } from '../lib/seed';

it('observes the seed head and supplies both replacement guards',async()=>{
 const calls:RequestInit[]=[];
 const call:typeof fetch=async(_url,init={})=>{
  calls.push(init);
  if(init.method!=='PUT')return Response.json({version:3,state:'observed'});
  const body=JSON.parse(String(init.body));
  return Response.json({}, {status:body.expectedVersion===3&&body.expectedState==='observed'?200:400});
 };
 await seedDocument('http://fixture','abc123','test-token','<p>Seed</p>',call);
 expect(calls).toHaveLength(2);
 expect(calls[1].headers).toMatchObject({authorization:'Bearer test-token'});
});
it('does not overwrite or retry when the observed seed changes',async()=>{
 let writes=0;
 const call:typeof fetch=async(_url,init={})=>{
  if(init.method!=='PUT')return Response.json({version:3,state:'observed'});
  writes++;return Response.json({error:'state_conflict'},{status:409});
 };
 await expect(seedDocument('http://fixture','abc123','test-token','<p>Seed</p>',call)).rejects.toThrow('409');
 expect(writes).toBe(1);
});
