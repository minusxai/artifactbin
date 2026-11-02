import {expect,it,vi} from 'vitest';
import {nativeSource} from './native-publication-fixture';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
vi.mock('@/lib/platform/config',async importOriginal=>({...await importOriginal<typeof import('@/lib/platform/config')>(),USER_PAGES_HOST:'u.example.test'}));
const harness=useAppHarness();
it.each(['public','unlisted'])('commits and replays changed and unchanged %s HTML receipts with owner hosts enabled',async visibility=>{
 const owner=await mintAccountToken('mxmx_test_host_receipt');
 const db=await harness.db();
 await db.query('UPDATE users SET username=$1 WHERE id=$2',['receipt_owner',owner.userId]);
 const made=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>Before</p>'),visibility}}));
 expect(made.status).toBe(201);
 let head=await made.json();
 for(const changed of [true,false]){
  const body={html:changed?nativeSource('<p>After</p>'):head.html,expectedVersion:head.version,expectedState:head.state};
  const send=()=>replace(request(`/api/artifacts/${head.id}`,{method:'PUT',token:owner.token,json:body,headers:{'Idempotency-Key':`mxmx_test_host_receipt_${changed}`}}),{params:Promise.resolve({id:head.id})});
  const saved=await send();
  expect(saved.status).toBe(200);
  const next=await saved.json();
  expect(next.user_page_url).toContain('receipt-owner.u.example.test');
  expect(next.version).toBe(head.version+(changed?1:0));
  expect(await (await send()).json()).toEqual(next);
  head=next;
 }
 expect((await db.query('SELECT 1 AS healthy')).rows[0]).toEqual({healthy:1});
});
