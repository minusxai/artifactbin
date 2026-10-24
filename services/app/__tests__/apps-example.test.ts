/** Native sharing replaces the retired JSX membership query; accepted membership stays server-authoritative. */
import {expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as members,POST as change} from '@/app/api/artifacts/[id]/members/route';
import {request,useAppHarness,mintAccountToken} from './harness';
useAppHarness();
it('exposes accepted members separately from pending requests through the retained native membership API',async()=>{
 const owner=await mintAccountToken('example-owner'),reader=await mintAccountToken('example-reader');
 const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head><title>Shared task app</title></head><body><h1>Tasks</h1></body></html>',visibility:'public'}}));expect(created.status).toBe(201);const {id}=await created.json(),context={params:Promise.resolve({id})};
 const read=async()=>{const r=await members(request(`/api/artifacts/${id}/members`,{token:owner.token}),context);expect(r.status).toBe(200);return r.json();};
 const write=async(token:string,body:unknown)=>{const r=await change(request(`/api/artifacts/${id}/members`,{method:'POST',token,json:body}),context);expect(r.status).toBe(200);};
 expect((await read()).members.map((m:{user_id:string})=>m.user_id)).toEqual([owner.userId]);
 // Creation accepts the owner once; explicit join is idempotent, never a second membership.
 await write(owner.token,{action:'join'});
 await write(reader.token,{action:'join'});let state=await read();expect(state.members.map((m:{user_id:string})=>m.user_id)).toEqual([owner.userId]);expect(state.pending.map((m:{user_id:string})=>m.user_id)).toEqual([reader.userId]);
 await write(owner.token,{action:'approve',userId:reader.userId});state=await read();expect(state.members.map((m:{user_id:string})=>m.user_id).sort()).toEqual([owner.userId,reader.userId].sort());expect(state.pending).toEqual([]);
 await write(reader.token,{action:'leave'});expect((await read()).members.map((m:{user_id:string})=>m.user_id)).toEqual([owner.userId]);
});
