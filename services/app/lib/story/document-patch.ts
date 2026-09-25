/** JSONB persistence primitives, behind the publication validator. Callers must bind
 * the plan to the exact baseline they validated. These are not client capabilities.
 * Arrays with a changed length are replaced at their nearest array boundary: no SQL
 * array expansion, ordering aggregate, or one UPDATE per child.
 */
export interface DocumentPatch {path:string[];value:unknown}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function prepareDocumentPatch(before:unknown,after:unknown):DocumentPatch[]{
 const patches:DocumentPatch[]=[];
 const visit=(a:unknown,b:unknown,path:string[])=>{
  if(Object.is(a,b))return;
  if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length){b.forEach((v,i)=>visit(a[i],v,[...path,String(i)]));return;}
  if(record(a)&&record(b)){
   const keys=Object.keys(b);
   if(Object.keys(a).length===keys.length&&keys.every(key=>Object.hasOwn(a,key))){keys.forEach(key=>visit(a[key],b[key],[...path,key]));return;}
  }
  patches.push({path,value:b});
 };
 visit(before,after,[]);
 // Bound expression depth and parameter count for a broad replacement. This is
 // still one atomic statement, and ordinary leaf edits never hit this bound.
 return patches.length>48?[{path:[],value:after}]:patches;
}
export function documentPatchSql(column:string,patches:DocumentPatch[],initial:unknown[]):{expression:string;params:unknown[]}{
 const params=[...initial];let expression=column;
 for(const patch of patches){
  if(!patch.path.length){params.push(JSON.stringify(patch.value));expression=`$${params.length}::jsonb`;continue;}
  params.push(patch.path,JSON.stringify(patch.value));
  expression=`jsonb_set(${expression},$${params.length-1}::text[],$${params.length}::jsonb,false)`;
 }
 return {expression,params};
}
