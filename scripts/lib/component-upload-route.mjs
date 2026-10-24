/** Observe only real same-origin upload responses. This route must be installed
 * during mount, after captureBrowserBaseline's broader page-resource guard. */
export async function observeUploadRequests({page,origin,proof,discardFirstSuccess=false}) {
 const records=[];let dropped=false;
 // A context route is insufficient: Playwright gives page routes precedence.
 await page.route('**/a/*/datasets/*/files',async route=>{
  const request=route.request();
  if(new URL(request.url()).origin!==origin){await route.fallback();return;}
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
