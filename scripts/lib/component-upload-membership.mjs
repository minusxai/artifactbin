import assert from 'node:assert/strict';
/** Normal owner participation, never a seeded relation or authentication bypass.
 * Default artifact-scoped insert grants require accepted membership. */
export async function uploadFixtureParticipation({origin,entries,token,send=fetch,mode='automatic-owner'}) {
 assert.ok(['automatic-owner','explicit-join'].includes(mode),'Known upload participation mode');
 const receipts=[];
 for(const {id} of entries){
  const response=await send(`${origin}/api/artifacts/${encodeURIComponent(id)}/members`,{method:mode==='explicit-join'?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(mode==='explicit-join'?{body:JSON.stringify({action:'join'})}:{})});
  assert.equal(response.status,200,'Actual owner membership request');
  const membership=await response.json();assert.equal(membership.self?.status,'accepted','Owner must have real accepted participation');
  receipts.push({id,status:membership.self.status});
 }
 return receipts;
}

export const joinUploadFixtures=options=>uploadFixtureParticipation({...options,mode:'explicit-join'});
