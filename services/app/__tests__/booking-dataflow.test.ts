/** Booking business rules now live in an authored backend, not platform JSX/SQL declarations. */
import {it,expect} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import {setServices} from '@/lib/platform';
import {localPageBackendCapability} from '@/lib/page-operations';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {useAppHarness,request,mintAccountToken} from './harness';
const harness=useAppHarness();
const source=`export const typeDefs='type Slot { id:ID! owner:ID } type Query { slots:[Slot!]! } type Mutation { book(slot:ID!):Boolean! @auth(role:VIEWER) cancel(slot:ID!):Boolean! @auth(role:VIEWER) }';
export default {
 slots:async(a,p,c)=>{const s=await c.store.get();return ['morning','afternoon'].map(id=>({id,owner:s.value?.[id]??null}));},
 book:async(a,p,c)=>{if(!p.subject)throw Error('sign_in_required');const s=await c.store.get();if(s.value?.[a.slot])throw Error('slot_taken');if(!['morning','afternoon'].includes(a.slot))throw Error('invalid_slot');await c.store.set({...s.value,[a.slot]:p.subject},{expected:s.version});return true;},
 cancel:async(a,p,c)=>{if(!p.subject)throw Error('sign_in_required');const s=await c.store.get();if(s.value?.[a.slot]!==p.subject)throw Error('not_your_booking');const next={...s.value};delete next[a.slot];await c.store.set(next,{expected:s.version});return true;}
};`;
it('books and cancels independently for signed-in viewers while refusing double booking and foreign cancellation',async()=>{
 const runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args)});setServices({runner});
 try{
 const owner=await mintAccountToken('booking-owner'),guest=await mintAccountToken('booking-guest');
 const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',html:'<html><head><link rel="af-backend" data-af-name="booking" href="./booking.ts"></head><body>Bookings</body></html>',backendSources:{booking:source}}}));expect(response.status).toBe(201);const {id}=await response.json();
 const call=async(query:string,token?:string)=>await(await graphql(request(`/api/artifacts/${id}/graphql`,{method:'POST',token,json:{revision:'1',query}}),{params:Promise.resolve({id})})).json();
 const book='mutation{booking{book(slot:"morning")}}',cancel='mutation{booking{cancel(slot:"morning")}}';
 expect((await call(book)).errors).toBeDefined();expect((await call(book,owner.token)).data.booking.book).toBe(true);
 expect((await call(book,guest.token)).errors).toBeDefined();expect((await call(cancel,guest.token)).errors).toBeDefined();
 expect((await call('{booking{slots{id owner}}}',guest.token)).data.booking.slots).toContainEqual({id:'morning',owner:owner.userId});
 expect((await call(cancel,owner.token)).data.booking.cancel).toBe(true);
 expect((await call(book,guest.token)).data.booking.book).toBe(true);expect((await call(cancel,guest.token)).data.booking.cancel).toBe(true);
 expect((await call('mutation{booking{book(guessed:"morning")}}',owner.token)).errors).toBeDefined();
 expect((await call('{booking{slots{id owner}}}')).data.booking.slots).toEqual([{id:'morning',owner:null},{id:'afternoon',owner:null}]);
 }finally{await runner.close();}
},20000);
