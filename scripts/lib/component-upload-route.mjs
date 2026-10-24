import {baselineLocalOrigin} from './component-baseline-session.mjs';
/** Observe only real same-origin upload responses. This route must be installed
 * during mount, after captureBrowserBaseline's broader page-resource guard. */
export async function observeUploadRequests({page,origin,runnerOrigin,proof,discardFirstSuccess=false}) {
 const origins=new Set([baselineLocalOrigin(origin)]);
 if(runnerOrigin){const runner=baselineLocalOrigin(runnerOrigin);if(new URL(runner).port!==new URL(origin).port)throw Error('Upload runner must use the same local app port');origins.add(runner);}
 const records=[];let dropped=false;
 // A context route is insufficient: Playwright gives page routes precedence.
 await page.route('**/a/*/datasets/*/files',async route=>{
  const request=route.request();
  if(!origins.has(new URL(request.url()).origin)){await route.fallback();return;}
  if(request.method()!=='POST'){await route.fallback();return;}
  const response=await route.fetch();const body=await response.body();let receipt;
  try{receipt=JSON.parse(body.toString());}catch{}
  const status=response.status(),requestId=request.headers()['idempotency-key'];
  records.push({status,requestId,receipt});proof.requests=records.length;proof.statuses.push(status);proof.requestIds.push(requestId);if(receipt?.ref)proof.refs.push(receipt.ref);
  if(discardFirstSuccess&&!dropped&&status===201){dropped=true;await route.abort('failed');}
  else await route.fulfill({response});
 });
 return records;
}
/** Read observed server results before waiting for presentation. In particular,
 * an unexpected authorization denial must stop the canary, not cost every state
 * a UI timeout. A missing transport response is independently bounded. */
export async function requireUploadResponse(records,count,status) {
 const deadline=Date.now()+10_000;
 while(records.length<count){if(Date.now()>=deadline)throw Error('No upload response within 10 seconds');await new Promise(resolve=>setTimeout(resolve,25));}
 const record=records[count-1];
 if(record.status!==status)throw Error(`Upload response expected ${status}, received ${record.status}`);
 return record;
}
