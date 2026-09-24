/**
 * Research boundary, not a product API.
 * Admission reuses the ENTIRE publish pipeline; persistence receives only its canonical result.
 * A prepared patch is bound to the exact version validated. Therefore successful commit implies
 * stored AST == admitted AST (induction from a valid initial row). This preserves ALL existing
 * publish rules, but does not eliminate whole-document validation or head conflicts.
 * JSONB path primitives are an implementation detail, never client-authorized operations.
 */
import assert from 'node:assert/strict';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {serializeJsx} from '../../services/app/lib/jsx/serialize.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {analyzeRowScopes} from '../../services/app/lib/story/row-scope.ts';

const needsStringEncoding=value=>typeof value==='string'&&(value.includes('\0')||!value.isWellFormed());
const pack=value=>needsStringEncoding(value)?['string16',Buffer.from(value,'utf16le').toString('base64')]:Array.isArray(value)?['array',value.map(pack)]:value&&typeof value==='object'?['object',Object.entries(value).map(([k,v])=>[needsStringEncoding(k)?pack(k):k,pack(v)])]:['value',value];
const unpack=([type,value])=>type==='string16'?Buffer.from(value,'base64').toString('utf16le'):type==='object'?Object.fromEntries(value.map(([k,v])=>[Array.isArray(k)?unpack(k):k,unpack(v)])):type==='array'?value.map(unpack):value;
function encode(value){
 if(Array.isArray(value))return value.map(encode);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='start'&&k!=='end').map(([k,v])=>[k,k==='json'?pack(v):encode(v)]));
}
function decode(value){
 if(Array.isArray(value))return value.map(decode);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='json'?unpack(v):decode(v)]));
}
export function encodeSource(source){const parsed=parseJsx(source);assert.ok(parsed.ok);return {schema:1,roots:encode(parsed.nodes)};}
export function decodeSource(document){assert.equal(document.schema,1);return serializeJsx(decode(document.roots));}
export function diff(before,after,path=[]){
 if(JSON.stringify(before)===JSON.stringify(after))return [];
 if(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length)return after.flatMap((value,i)=>diff(before[i],value,[...path,String(i)]));
 if(before&&after&&!Array.isArray(before)&&!Array.isArray(after)&&typeof before==='object'&&typeof after==='object'&&JSON.stringify(Object.keys(before).sort())===JSON.stringify(Object.keys(after).sort()))return Object.keys(after).flatMap(k=>diff(before[k],after[k],[...path,k]));
 return [{path,value:after}];
}
const admitted=new WeakMap();
export async function prepareOperation(before,candidate,context){
 assert.equal(typeof context?.loadRef,'function','Publication requires a reference loader; preview validation is insufficient');
 const published=await publishJsx({},candidate,context);
 if(published instanceof Response)return published;
 const document=encodeSource(published.source);
 assert.equal(decodeSource(document),published.source);
 const paths=certifyPlainDocument(document);
 const details={id:before.id,version:before.version,patches:diff(before.document,document),meta:published.meta,bytes:Buffer.byteLength(published.source),capabilities:paths?Object.fromEntries(paths.map(p=>[JSON.stringify(p),true])):{}};
 // Only this process's validated objects can cross the persistence boundary.
 const operation=Object.freeze({});admitted.set(operation,details);return operation;
}
export async function commitOperation(query,id,certificate){
 const operation=admitted.get(certificate);assert.ok(operation,'Unvalidated operation');
 assert.equal(operation.id,id,'Certificate belongs to another artifact');
 const params=[id,operation.version,JSON.stringify(operation.meta)];let expression='document';
 for(const patch of operation.patches){
  params.push(patch.path,JSON.stringify(patch.value));
  expression=patch.path.length?`jsonb_set(${expression},$${params.length-1}::text[],$${params.length}::jsonb,false)`:`$${params.length}::jsonb`;
 }
 params.push(operation.bytes,JSON.stringify(operation.capabilities));
 return (await query(`UPDATE validation_documents SET document=${expression},meta=$3::jsonb,version=version+1,epoch=epoch+1,source_bytes=$${params.length-1},capabilities=$${params.length}::jsonb,revisions='{}'::jsonb WHERE id=$1 AND version=$2 RETURNING version`,params)).rows;
}

/** Closed, deliberately narrow fast contract: fixed plain HTML tree, literal prose only.
 * Certification is server-owned and invalidated by EVERY general operation. This is not a
 * claim that arbitrary JSX text (SQL, scripts, Mermaid, CSS, etc.) is interchangeable prose.
 * Special text goes through prepareOperation, retaining the existing acceptance vocabulary.
 */
const plainTags=new Set(['section','article','div','p','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','blockquote']);
const scannerSyntax=/\b(?:class(?:Name)?|data-design|style)\s*=/i;
const validText=s=>typeof s==='string'&&!s.includes('\0')&&!s.includes('\r\n')&&s.isWellFormed()&&!scannerSyntax.test(s)&&analyzeRowScopes([{type:'text',value:s,start:0,end:s.length}]).errors.length===0;
const textSource=s=>serializeJsx([{type:'text',value:s,start:0,end:0}]);
export function encodeProseText(value){assert.ok(validText(value),'Text requires full preparation');return textSource(value);}
export function certifyPlainDocument(document){
 const paths=[];
 const visit=(node,path)=>{
  if(node.type==='text'){if(!validText(node.value))return false;paths.push([...path,'value']);return true;}
  return node.type==='element'&&!node.control&&plainTags.has(node.tag)
   &&node.attributes.every(a=>['id','className'].includes(a.name)&&a.value.static&&a.value.json[0]==='value'&&typeof a.value.json[1]==='string'&&!/["'=<>]/.test(a.value.json[1]))
   &&node.children.every((child,i)=>visit(child,[...path,'children',String(i)]));
 };
 return document.roots.every((node,i)=>visit(node,['roots',String(i)]))?paths:null;
}
export function preparePlainText({path,oldText,newText,baseVersion,epoch}){
 assert.ok(validText(oldText)&&validText(newText),'Text requires full preparation');
 assert.ok(Array.isArray(path)&&path.every(p=>typeof p==='string'));
 assert.ok(Number.isSafeInteger(baseVersion)&&baseVersion>=1&&Number.isSafeInteger(epoch)&&epoch>=1);
 const certificate=Object.freeze({});
 admitted.set(certificate,{path:[...path],oldText,newText,baseVersion,epoch,delta:Buffer.byteLength(textSource(newText))-Buffer.byteLength(textSource(oldText))});
 return certificate;
}
export async function commitPlainText(query,id,certificate){
 const op=admitted.get(certificate);assert.ok(op&&'newText'in op,'Unvalidated text operation');
 return (await query(`UPDATE validation_documents SET
 document=jsonb_set(document,$2::text[],to_jsonb($4::text),false),
 revisions=jsonb_set(revisions,ARRAY[$8::text],to_jsonb(version+1),true),
 source_bytes=source_bytes+$7::int,version=version+1
 WHERE id=$1 AND epoch=$6 AND version >= $5
 AND capabilities ? $8
 AND COALESCE((revisions->>$8)::int,0) <= $5
 AND document#>>$2::text[]=$3
 AND source_bytes+$7::int BETWEEN 0 AND 2000000
 RETURNING version`,[id,op.path,op.oldText,op.newText,op.baseVersion,op.epoch,op.delta,JSON.stringify(op.path)])).rows;
}
