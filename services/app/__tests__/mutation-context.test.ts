import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/platform';
import { durableMutation } from '@/lib/artifacts';
import { pinMutationContext } from '@/lib/artifacts/mutation-receipt';
import { completeDocumentMutationReceipt } from '@/lib/artifacts/mutation-operation';
useAppHarness();
it('pins context before work and reads the winning canonical receipt for first and repeated calls',async()=>{
 const actor={userId:null,tokenId:'mxmx_test_token'};
 let calls=0;
 const work=()=>durableMutation(actor,'http://localhost:5001','mxmx_test_saved_context',{mutation:'add'},async receipt=>{
  calls++;
  await pinMutationContext(receipt,{bindings:{n:7},revision:'old'});
  expect(receipt.runId).not.toContain('mxmx_test_saved_context');
  const success={datasetId:'dataset',datasetEditId:'edit',version:2,affected:1,rowCount:2,mutationRunId:receipt.runId};
  await (await getDb()).transaction(tx=>completeDocumentMutationReceipt(tx,receipt,success));
  return {status:200,body:{wrongRouteShape:true}};
 });
 const first=await work(),replay=await work();
 expect(replay).toEqual(first);expect(first.body).toHaveProperty('mutationOperation');expect(calls).toBe(1);
 const rows=await (await getDb()).query<{context:object}>('SELECT context FROM mutation_receipts');
 expect(rows.rows[0]!.context).toEqual({bindings:{n:7},revision:'old'});
});
it('will not execute an interrupted claimed operation again or overwrite a pinned context',async()=>{
 const actor={userId:null,tokenId:'mxmx_test_token'};let calls=0;
 const work=()=>durableMutation(actor,'http://localhost:5001','mxmx_test_interrupted_context',{},async receipt=>{
  calls++;await pinMutationContext(receipt,{revision:'original'});
  await expect(pinMutationContext(receipt,{revision:'replacement'})).rejects.toThrow('mutation_context_already_claimed');
  throw new Error('connection lost');
 });
 await expect(work()).rejects.toThrow('connection lost');
 expect((await work()).body.error).toBe('operation_pending');expect(calls).toBe(1);
});
