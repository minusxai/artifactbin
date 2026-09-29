/** Internal disposable smoke only: lose one committed mutation response, never the request.
 * Stores only public operation receipts, never credentials or request bodies.
 */
import {existsSync,writeFileSync} from 'node:fs';
const document=process.env.NOTIFY_SMOKE__DOCUMENT;
const receipt=process.env.NOTIFY_SMOKE__RECEIPT;
const port=process.env.APP__PORT;
if(document&&receipt&&port){
 if(!/^[A-Za-z0-9]+$/.test(document)||!/^\d+$/.test(port))throw new Error('Invalid local notification smoke target');
 const target=`http://localhost:${port}/api/artifacts/${document}/mutate`;
 const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const response=await original(input,init);
  if(String(input)===target&&init?.method==='POST'&&response.ok&&!existsSync(receipt)){
   const result=await response.clone().json();
   writeFileSync(receipt,JSON.stringify({mutationRunId:result.mutationRunId,version:result.version,affected:result.affected}),{flag:'wx'});
   throw new Error('Disposable notification smoke: response lost after commit');
  }
  return response;
 };
}
