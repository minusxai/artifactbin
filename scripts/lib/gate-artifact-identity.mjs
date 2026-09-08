/** Gate-only reads: never recover an artifact id by splitting a pretty slug. */
export function readArtifactBootstrapId(doc=document){
 const element=doc.head.querySelector('script#mx-page-data[type="application/json"]');
 const id=JSON.parse(element?.textContent??'null')?.artifact?.surface?.id;
 if(typeof id!=='string'||!id)throw new Error('Artifact bootstrap identity missing');
 return id;
}
export async function hasCommentPermission(page,id){
 if(typeof id!=='string'||!id)throw new Error('Fixture artifact id required');
 return page.evaluate(async artifactId=>{
  const response=await fetch('/api/page/artifact/'+encodeURIComponent(artifactId),{headers:{'x-artifactbin-csrf':'1'}});
  if(!response.ok)throw new Error('Page permission read failed: '+response.status);
  return ['owner','editor','commenter'].includes((await response.json()).role);
 },id);
}
