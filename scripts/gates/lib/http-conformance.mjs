/** Direct HTTP release acceptance. Credentials stay in memory; errors never print response bodies. */
import assert from 'node:assert/strict';
const mintRequest=(base,cookie)=>({method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:'{}'});
export async function checkGuestHttpIssuance({base,fetch,guestCookie}){
 // Signed-out callers, including retired guest cookies, cannot mint credentials.
 const response=await fetch(`${base}/api/authentication/token`,mintRequest(base,guestCookie));
 assert.equal(response.status,401,'Guest sessions cannot issue direct HTTP bearers');
 assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.error,'email_auth_required');
 assert.ok(!('access_token' in body),'Refusal must not issue a credential');
}
export async function checkDirectHttp({base,fetch,accountCookie,artifactId,stamp,onArtifact}){
 const tokenIds=async()=>{const response=await fetch(`${base}/api/my/tokens`,{headers:{cookie:accountCookie}});assert.equal(response.status,200);return new Set((await response.json()).tokens.map(token=>token.id));};
 const beforeTokens=await tokenIds();
 const issued=await fetch(`${base}/api/authentication/token`,mintRequest(base,accountCookie));
 assert.equal(issued.status,201,'Verified email session issues an HTTP bearer');
 let credential=await issued.json();
 assert.ok(typeof credential.id==='string'&&typeof credential.access_token==='string'&&/^mx_/.test(credential.access_token),'Mint returned an identifiable bearer');
 const api=(path,init={})=>fetch(base+path,{...init,headers:{authorization:`Bearer ${credential.access_token}`,...init.headers}});
 const json=(method,body,headers={})=>({method,headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal(issued.headers.get('cache-control'),'no-store');
  assert.equal(credential.token_type,'Bearer');assert.equal(credential.scope,'artifacts');assert.ok(Number.isFinite(credential.expires_in)&&credential.expires_in>0);
  assert.ok(typeof credential.refresh_token==='string'&&/^mxr_/.test(credential.refresh_token));assert.ok(typeof credential.client_id==='string');
  const renewed=await fetch(`${base}/oauth/token`,json('POST',{grant_type:'refresh_token',client_id:credential.client_id,refresh_token:credential.refresh_token,resource:base+'/api'}));
  assert.equal(renewed.status,200,'HTTP credentials refresh without login cookies');
  const next=await renewed.json();assert.ok(next.access_token!==credential.access_token&&next.refresh_token!==credential.refresh_token,'Refresh rotates both credentials');
  // Preserve issuance identity for cleanup; subsequent API calls use the renewed bearer.
  credential={...credential,...next};

  const created=await api('/api/artifacts',json('POST',{dataset:'region,amount\nEU,2\n',title:`mxmx_test_http_${stamp}`,visibility:'private'},{'Idempotency-Key':`mxmx_test_http_${stamp}`}));
  assert.equal(created.status,201,'Direct bearer publishes CSV');const {id}=await created.json();assert.ok(typeof id==='string');onArtifact(id);
  const read=async()=>{const response=await api(`/api/artifacts/${id}`);assert.equal(response.status,200);return response.json();};
  const content=async()=>{const response=await api(`/api/artifacts/${id}/content`);assert.equal(response.status,200);return response.json();};
  const head=await read();assert.equal(head.format,'dataset');assert.equal(Number((await content())[0].amount),2);
  const changed=await api(`/api/artifacts/${id}`,json('PUT',{dataset:'region,amount\nEU,20\n',expectedVersion:head.version,expectedState:head.state}));
  assert.equal(changed.status,200,'Direct bearer replaces CSV with its observed fence');
  const before=await read(),beforeContent=await content();assert.equal(before.version,head.version+1);assert.equal(Number(beforeContent[0].amount),20);
  const refused=await api(`/api/artifacts/${id}`,json('PUT',{dataset:'region,amount\nEU,999\n',expectedVersion:before.version,expectedState:before.state},{'User-Agent':'afbin/0.3.21','X-Artifactbin-Protocol':'3'}));
  assert.equal(refused.status,426,'Retired native CLI is refused before mutation');
  assert.equal(refused.headers.get('X-Artifactbin-Protocol'),null);
  const notice=await refused.json();assert.equal(notice.error,'cli_npm_required');assert.match(notice.message,/installs through npm/);assert.match(notice.message,/npx --yes @afbin\/cli@latest setup/);assert.match(notice.hint,/npx\.cmd/);
  const helperUrls=notice.hint.match(/https?:\/\/[^\s,)]+\/chat\/install-node\.(?:sh|ps1)/g)??[];
  assert.deepEqual(helperUrls,[`${base}/chat/install-node.sh`,`${base}/chat/install-node.ps1`],'Node setup helpers must use the public acceptance origin');
  const after=await read();assert.equal(after.version,before.version);assert.equal(after.state,before.state);assert.deepEqual(await content(),beforeContent,'Native refusal cannot change stored CSV');
  // The direct bearer is API-scoped; the authenticated browser session owns the
  // reader download door. Do not broaden the credential to make this test pass.
  const downloaded=await fetch(`${base}/a/${artifactId}/download`,{headers:{cookie:accountCookie}});
  assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-type')??'',/^text\/html/);
  assert.match(downloaded.headers.get('content-disposition')??'',/^attachment; filename="[^"\r\n]+\.jsx\.html"/);
  const html=await downloaded.text();assert.ok(html.includes('id="afbin-file"'),'Download carries the offline file payload');assert.ok(!html.includes(credential.access_token),'Download must not contain the bearer');
 }finally{
  for(const id of await tokenIds())if(!beforeTokens.has(id)){
   const revoked=await fetch(`${base}/api/my/tokens/${encodeURIComponent(id)}`,{method:'DELETE',headers:{cookie:accountCookie,origin:base}});
   assert.equal(revoked.status,204,'Disposable HTTP credentials and refresh grants are revoked');
  }
 }
}
