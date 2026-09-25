/** Server-owned JSONB primitives. They compose on values inside one statement;
 * publication admission must bind them to the exact node facets it validated. */
import type {JsonDocumentPatch as DocumentPatch} from '@artifactbin/contracts';
export type {JsonDocumentPatch as DocumentPatch} from '@artifactbin/contracts';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function equal(a:unknown,b:unknown):boolean {
 if(Object.is(a,b))return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
 if(record(a)&&record(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));}
 return false;
}
export function prepareDocumentPatch(before:unknown,after:unknown):DocumentPatch[]{
 const patches:DocumentPatch[]=[];
 const visit=(a:unknown,b:unknown,path:string[])=>{
  if(equal(a,b))return;
  if(typeof a==='string'&&typeof b==='string'){
   // PostgreSQL substring offsets count code points, not JavaScript UTF-16 units.
   const left=Array.from(a),right=Array.from(b);let start=0,end=0;
   while(start<left.length&&start<right.length&&left[start]===right[start])start++;
   while(end<left.length-start&&end<right.length-start&&left[left.length-end-1]===right[right.length-end-1])end++;
   const patch:DocumentPatch={kind:'text',path,start,deleteCount:left.length-start-end,value:right.slice(start,right.length-end).join('')};
   if(JSON.stringify(patch).length<JSON.stringify({kind:'set',path,value:b}).length){patches.push(patch);return;}
  }
  if(Array.isArray(a)&&Array.isArray(b)){
   if(a.length===b.length){b.forEach((value,index)=>visit(a[index],value,[...path,String(index)]));return;}
   let start=0,end=0;
   while(start<a.length&&start<b.length&&equal(a[start],b[start]))start++;
   while(end<a.length-start&&end<b.length-start&&equal(a[a.length-end-1],b[b.length-end-1]))end++;
   for(let index=a.length-end-1;index>=start;index--)patches.push({kind:'delete',path:[...path,String(index)]});
   for(let index=start;index<b.length-end;index++)patches.push({kind:'insert',path:[...path,String(index)],value:b[index]});
   return;
  }
  if(record(a)&&record(b)){
   for(const key of Object.keys(a))if(!Object.hasOwn(b,key))patches.push({kind:'delete',path:[...path,key]});
   for(const [key,value] of Object.entries(b))if(Object.hasOwn(a,key))visit(a[key],value,[...path,key]);else patches.push({kind:'set',path:[...path,key],value});
   return;
  }
  patches.push({kind:'set',path,value:b});
 };
 visit(before,after,[]);
 // Bound per-node expression/recursion depth for dense replacements. This never
 // turns an ordinary edit into a whole-document replacement in the graph writer.
 return patches.length>48?[{kind:'set',path:[],value:after}]:patches;
}

/** Reference interpreter for compiler conformance and graph admission tests. */
export function applyDocumentPatch(before:unknown,patches:readonly DocumentPatch[]):unknown {
 let value=structuredClone(before);
 for(const patch of patches){
  let parent=value;
  for(const key of patch.path.slice(0,-1))parent=(parent as Record<string,unknown>)[key];
  const key=patch.path.at(-1),old=key===undefined?value:(parent as Record<string,unknown>)[key];
  if(patch.kind==='delete'){
   if(Array.isArray(parent))parent.splice(Number(key),1);else delete (parent as Record<string,unknown>)[key!];
   continue;
  }
  let next=structuredClone(patch.value);
  if(patch.kind==='text'){
   const points=Array.from(old as string);next=points.slice(0,patch.start).join('')+patch.value+points.slice(patch.start+patch.deleteCount).join('');
  }
  if(key===undefined)value=next;
  else if(patch.kind==='insert'&&Array.isArray(parent))parent.splice(Number(key),0,next);
  else Object.defineProperty(parent,key,{value:next,enumerable:true,writable:true,configurable:true});
 }
 return value;
}
export function documentPatchSql(column:string,patches:DocumentPatch[],initial:unknown[]):{expression:string;params:unknown[]}{
 const params=[...initial,JSON.stringify(patches)],bound=`$${params.length}::jsonb`;
 const stages=patches.map((_,step)=>`CROSS JOIN LATERAL (SELECT ${documentPatchStepSql(step?`s${step-1}.value`:'base.value',`(${bound}->${step})`)} AS value OFFSET 0) s${step}`);
 const expression=patches.length?`(SELECT s${patches.length-1}.value FROM (SELECT ${column} AS value OFFSET 0) base ${stages.join(' ')})`:column;
 return {expression,params};
}

/** One dynamic step, used by the bounded per-node SQL fold. No stored function,
 * full-array expansion, or second database statement is needed. */
export function documentPatchStepSql(value:string,patch:string):string {
 const path=`ARRAY(SELECT jsonb_array_elements_text(${patch}->'path'))`;
 const old=`(${value}#>>${path})`,text=`to_jsonb(left(${old},(${patch}->>'start')::int)||(${patch}->>'value')||substring(${old} FROM (${patch}->>'start')::int+(${patch}->>'deleteCount')::int+1))`;
 return `(CASE ${patch}->>'kind'
  WHEN 'delete' THEN ${value}#-${path}
  WHEN 'insert' THEN jsonb_insert(${value},${path},${patch}->'value',false)
  WHEN 'text' THEN CASE WHEN jsonb_array_length(${patch}->'path')=0 THEN ${text} ELSE jsonb_set(${value},${path},${text},true) END
  ELSE CASE WHEN jsonb_array_length(${patch}->'path')=0 THEN ${patch}->'value' ELSE jsonb_set(${value},${path},${patch}->'value',true) END END)`;
}
