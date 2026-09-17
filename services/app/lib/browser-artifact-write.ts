/** Browser metadata controls observe state just before a conditional write; body-only typing uses edits. */
export async function writeBrowserArtifact(id:string,change:Record<string,unknown>,editId?:string):Promise<Response>{
 const path=`/api/my/artifacts/${encodeURIComponent(id)}`;
 const observed=await fetch(path);
 if(!observed.ok)return observed;
 const head=await observed.json() as {state?:string;version?:number;edit_id?:string;markup?:string};
 if(typeof head.state!=='string'||!Number.isSafeInteger(head.version))return Response.json({error:'invalid_response',details:[{message:'Refresh the artifact before saving.'}]},{status:502});
 const {source,annotationOps,...metadata}=change;
 if(source!==undefined&&head.edit_id!==editId)return Response.json({error:'doc_changed',edit_id:head.edit_id,version:head.version,source:head.markup},{status:409});
 return fetch(path,{method:source===undefined?'PATCH':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  ...metadata,expectedState:head.state,...(source!==undefined&&Array.isArray(annotationOps)&&annotationOps.length?{annotation_ops:annotationOps}:{}),...(source!==undefined?{markup:source,expectedVersion:head.version}:{}),
 })});
}
