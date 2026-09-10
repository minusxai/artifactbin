import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {DELETE as remove} from '@/app/api/artifacts/[id]/route';
const harness=useAppHarness();
const key='operation-0123456789abcdef';
const createRequest=(token:string,json:Record<string,unknown>,operation=key)=>create(request('/api/artifacts',{method:'POST',token,headers:{'Idempotency-Key':operation},json}));
it('commits one artifact for simultaneous same-key requests and replays the original response',async()=>{
 const token=await mintToken('idempotency');const body={markup:'<p>Same</p>'};
 const [first,second]=await Promise.all([createRequest(token.token,body),createRequest(token.token,body)]);
 expect(first.status).toBe(201);expect(second.status).toBe(201);
 const original=await first.json();expect(await second.json()).toEqual(original);
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts WHERE token_id=$1',[token.id])).rows[0].n).toBe(1);
 const replay=await createRequest(token.token,body);expect(await replay.json()).toEqual(original);
});
it('refuses payload mismatch and never recreates a deleted result',async()=>{
 const token=await mintToken('idempotency');const body={markup:'<p>Same</p>'};
 const first=await createRequest(token.token,body);const id=(await first.json()).id;
 const mismatch=await createRequest(token.token,{markup:'<p>Changed</p>'});
 expect(mismatch.status).toBe(409);expect((await mismatch.json()).error).toBe('idempotency_mismatch');
 const removed=await remove(request(`/api/artifacts/${id}`,{method:'DELETE',token:token.token}),{params:Promise.resolve({id})});expect(removed.status).toBe(200);
 const replay=await createRequest(token.token,body);expect(replay.status).toBe(410);expect((await replay.json()).error).toBe('result_deleted');
 const db=await harness.db();expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts WHERE token_id=$1',[token.id])).rows[0].n).toBe(1);
});
it('scopes operation keys to the authenticated principal',async()=>{
 const one=await mintToken('one');const two=await mintToken('two');const body={markup:'<p>Same</p>'};
 const a=await createRequest(one.token,body);const b=await createRequest(two.token,body);
 expect((await a.json()).id).not.toBe((await b.json()).id);
});
it('keeps durable identity after the one-day response window expires',async()=>{
 const token=await mintToken('expiry');const body={markup:'<p>Same</p>'};
 const first=await createRequest(token.token,body);const id=(await first.json()).id;
 const db=await harness.db();await db.query("UPDATE artifact_creation_operations SET response_until=now()-interval '1 second'");
 const replay=await createRequest(token.token,body);expect(replay.status).toBe(200);
 expect(await replay.json()).toEqual({id,recovered:true,response_expired:true});
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM artifacts WHERE token_id=$1',[token.id])).rows[0].n).toBe(1);
});
it('raw byte uploads use the same durable operation ledger',async()=>{
 const token=await mintToken('raw');
 const send=()=>create(new Request('http://localhost/api/artifacts?format=file&filename=note.txt',{method:'POST',headers:{authorization:`Bearer ${token.token}`,'content-type':'text/plain','Idempotency-Key':key},body:'hello'}));
 const first=await send();const second=await send();expect(first.status).toBe(201);expect(second.status).toBe(201);
 expect(await second.json()).toEqual(await first.json());
});
it('refuses a mismatched workspace account before publication and returns account identity with necessary responses',async()=>{
 const token=await mintToken('account');
 const refused=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'X-Artifactbin-Account':'usr_wrong'},json:{markup:'<p>No</p>'}}));
 expect(refused.status).toBe(409);expect((await refused.json()).error).toBe('account_mismatch');
 const accepted=await createRequest(token.token,{markup:'<p>Yes</p>'});expect(accepted.headers.get('X-Artifactbin-Account')).toBe(token.id);
});
