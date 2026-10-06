import {it,expect} from 'vitest';
import {jsonRouteResponse} from '../gates/lib/json-route-response.mjs';
it('reads and delivers the real JSON response once before resolving',async()=>{
 const events=[],response={json:async()=>{events.push('read');return {id:'abc123'};}};
 const result=await jsonRouteResponse({fetch:async()=>{events.push('fetch');return response;},fulfill:async value=>{expect(value.response).toBe(response);events.push('deliver');},abort:async()=>{throw Error('must not abort success');}});
 expect(result).toEqual({response,body:{id:'abc123'}});expect(events).toEqual(['fetch','read','deliver']);
});
it('returns a reset to the awaiting gate and aborts its browser request, without replaying the POST',async()=>{
 const error=Error('read ECONNRESET');let calls=0,aborts=0;
 const outcome=await jsonRouteResponse({fetch:async()=>{calls++;throw error;},fulfill:async()=>{throw Error('must not deliver a failed request');},abort:async()=>{aborts++;}});
 expect(outcome.error).toBe(error);expect(calls).toBe(1);expect(aborts).toBe(1);
});
