import assert from 'node:assert/strict';
/** Normal owner participation, never a seeded relation or authentication bypass.
 * Default artifact-scoped insert grants require accepted membership. */
export async function joinUploadFixtures({origin,entries,token,send=fetch}) {
 const receipts=[];
 for(const {id} of entries){
  const response=await send(`${origin}/api/artifacts/${encodeURIComponent(id)}/members`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action:'join'})});
  assert.equal(response.status,200,'Actual owner membership request');
  const membership=await response.json();assert.equal(membership.self?.status,'accepted','Owner must have real accepted participation');
  receipts.push({id,status:membership.self.status});
 }
 return receipts;
}
