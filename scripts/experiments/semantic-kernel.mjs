/** Reference contract, not a product integration.
 * One row holds a semantic AST and certified inert prose leaves. The publisher validates
 * EVERY other byte. A structural operation is admitted on the semantic projection, then
 * bound to that projection's epoch/hash and the values it consumed. Ordinary prose writes
 * do not invalidate the projection. SQL guards the size aggregate on the locked row.
 * No SQL UDF, CHECK validator, per-node row, SELECT-before-commit, or server retry.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {repairJsxSource} from '../../services/app/lib/jsx/repair.ts';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {splitHelmet} from '../../services/app/lib/story/helmet.ts';
import {documentFonts} from '../../services/app/lib/story/document-fonts.ts';
import {storyCssCompileVersion} from '../../services/app/lib/data/story/story-css.server.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {encodeSource,decodeSource,diff,encodeProseText} from './validated-operations.mjs';

// Match the TEXT driver's UTF-8 transport for raw lone surrogates. Escaped JSON
// literals remain byte-for-byte ASCII and are handled losslessly by the AST codec.
async function publish(body,source,context){
 if(source.includes('\0'))return new Response(JSON.stringify({error:'invalid_source_encoding'}),{status:400});
 const result=await publishJsx(body,Buffer.from(source,'utf8').toString('utf8'),context);
 if(result instanceof Response)return result;
 if(result.source.includes('\0'))return new Response(JSON.stringify({error:'invalid_source_encoding'}),{status:400});
 return result.source.isWellFormed()?result:publishJsx(body,Buffer.from(result.source,'utf8').toString('utf8'),context);
}
const plain=new Set(['section','article','div','p','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','blockquote','header','footer','main','aside','a','b','i','u','s']);
const clone=structuredClone;
const key=()=>randomBytes(12).toString('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const fingerprint=tree=>createHash('sha256').update(JSON.stringify(canonical(tree))).digest('hex');
const get=(obj,path)=>path.reduce((n,k)=>n[k],obj);
const bytes=s=>Buffer.byteLength(s,'utf8');
const safe=s=>{try{encodeProseText(s);return !/<\/?style\b/i.test(s);}catch{return false;}};
const raw=s=>encodeProseText(s);
export function encodeSemanticProseText(value){assert.ok(safe(value),'Needs semantic operation');return raw(value);}
const walk=(tree,visit)=>{const each=(nodes,ancestors=[])=>nodes.forEach(n=>{visit(n,ancestors);if(n.type==='element')each(n.children,[...ancestors,n]);});each(tree.roots);};
const ids=tree=>{const found=[];walk(tree,n=>{if(n.slot)found.push(n.slot);});assert.equal(new Set(found).size,found.length,'A prose slot may occur only once');return found;};
// Only the nearest prose element is significant. Kit/For/fragment ancestors do not
// inspect that leaf's inert value; Helmet and the executable iframe boundary do.
const eligible=(node,parents)=>node.type==='text'&&plain.has(parents.at(-1)?.tag)&&!parents.some(p=>p.tag==='Helmet'||p.tag==='Iframe');
// Source scanners are global regular expressions. A scanner-like token in an opaque
// value defeats isolation; conservatively materialize all prose for those documents.
const scanners=/\b(?:class(?:Name)?|data-design|style)\s*=|<\/?style\b/i;
function scannerIsolated(tree){let isolated=true;walk(tree,n=>{
 if(n.type==='text'&&!n.slot&&scanners.test(n.value))isolated=false;
 if(n.type==='expression'&&scanners.test(JSON.stringify(n)))isolated=false;
 if(n.type==='element'&&n.attributes.some(a=>scanners.test(JSON.stringify(a.value))))isolated=false;
});return isolated;}
export function renderState(document){const tree=clone(document.tree);walk(tree,n=>{if(n.slot){assert.ok(document.prose[n.slot]);n.value=document.prose[n.slot].value;delete n.slot;}});return decodeSource(tree);}
function fixedBytes(tree){const copy=clone(tree);walk(copy,n=>{if(n.slot)n.value='';});return bytes(decodeSource(copy));}
function project(tree,observations,{extract=true}={}){
 const consumed=new Set(),fresh={},used=new Set([...Object.keys(observations),...ids(tree)]);let isolated=scannerIsolated(tree);
 const hydrate=n=>{assert.ok(observations[n.slot],`Missing context for slot ${n.slot}`);consumed.add(n.slot);n.value=observations[n.slot].value;delete n.slot;};
 // Adjacent text nodes can form scanner syntax across two independently edited leaves.
 // Materialize their whole run; parsing the published result merges it before recertifying.
 const adjacent=new Set();const adjacency=nodes=>{for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.type==='text'&&(nodes[i-1]?.type==='text'||nodes[i+1]?.type==='text'))adjacent.add(n);if(n.type==='element')adjacency(n.children);}};adjacency(tree.roots);
 walk(tree,(n,parents)=>{if(n.slot&&(!isolated||!eligible(n,parents)||adjacent.has(n)))hydrate(n);});
 // Hydration may expose a scanner token. Existing certified slots are inert, but this
 // second check also handles user-supplied materialized values without trusting them.
 isolated=scannerIsolated(tree);
 if(!isolated)walk(tree,n=>{if(n.slot)hydrate(n);});
 if(extract&&isolated)walk(tree,(n,parents)=>{if(!n.slot&&eligible(n,parents)&&!adjacent.has(n)&&safe(n.value)){
  let slot=key();while(used.has(slot))slot=key();used.add(slot);fresh[slot]={value:n.value,bytes:bytes(raw(n.value))};n.value='';n.slot=slot;
 }});
 return {tree,consumed,fresh};
}
function projectedSource(tree){
 const copy=clone(tree),markers=new Map(),nonce=key();
 walk(copy,n=>{if(n.slot){const marker=`Prose${nonce}Slot${n.slot}End`;markers.set(marker,n.slot);n.value=marker;delete n.slot;}});
 return {source:decodeSource(copy),markers};
}
function recoverTree(source,markers){
 const tree=encodeSource(source);const matched=new Set();
 walk(tree,n=>{if(n.type==='text'&&markers.has(n.value)){const slot=markers.get(n.value);assert.ok(!matched.has(slot));matched.add(slot);n.slot=slot;n.value='';}});
 assert.equal(matched.size,markers.size,'Normalization changed a projected prose boundary');return tree;
}
function needsContext(tree,meta){
 const parsed=parseJsx(decodeSource(tree));assert.ok(parsed.ok);
 return (meta.refs?.length??0)>0||documentFonts(splitHelmet(parsed.nodes).content).families.length>0;
}
const admitted=new WeakMap();
function certificate(details){const result=Object.freeze({});admitted.set(result,clone(details));return result;}

const inputTree=source=>encodeSource(repairJsxSource(source)?.source??source);
function applyOperations(tree,operations){
 assert.ok(Array.isArray(operations)&&operations.length>0);
 for(const op of operations){
  if(op.kind==='replaceDocument'){tree=inputTree(op.source);continue;}
  if(op.kind==='insert'){
   const list=op.parent.length?get(tree,op.parent).children:tree.roots;
   assert.ok(Array.isArray(list)&&Number.isInteger(op.index)&&op.index>=0&&op.index<=list.length);
   list.splice(op.index,0,...inputTree(op.source).roots);continue;
  }
  assert.ok(Array.isArray(op.path)&&op.path.length>=2);const node=get(tree,op.path);assert.ok(node);
  if(op.kind==='setAttribute'||op.kind==='removeAttribute'){
   assert.equal(node.type,'element');assert.match(op.name,/^[A-Za-z_][\w:.-]*$/);
   const index=node.attributes.findIndex(a=>a.name===op.name);
   if(op.kind==='removeAttribute'){if(index>=0)node.attributes.splice(index,1);continue;}
   const attribute=encodeSource(`<div ${op.name}={${JSON.stringify(op.value)}} />`).roots[0].attributes[0];
   if(index>=0)node.attributes[index]=attribute;else node.attributes.push(attribute);continue;
  }
  if(op.kind==='setText'){assert.equal(node.type,'text');assert.equal(typeof op.value,'string');delete node.slot;node.value=op.value;continue;}
  const list=get(tree,op.path.slice(0,-1)),index=Number(op.path.at(-1));assert.ok(Array.isArray(list)&&list[index]===node);
  if(op.kind==='delete'){list.splice(index,1);continue;}
  if(op.kind==='replace'){list.splice(index,1,...inputTree(op.source).roots);continue;}
  if(op.kind==='move'){
   const parent=op.parent.length?get(tree,op.parent):null,target=parent?parent.children:tree.roots;
   assert.ok(Array.isArray(target));const descendants=new Set();walk({roots:[node]},n=>descendants.add(n));assert.ok(!descendants.has(parent),'Move would create a cycle');
   assert.ok(Number.isInteger(op.index)&&op.index>=0&&op.index<=target.length);list.splice(index,1);target.splice(op.index,0,node);continue;
  }
  throw new Error(`Unknown operation ${op.kind}`);
 }
 return tree;
}

/** Caller supplies the semantic snapshot it already read and any consumed prose values.
 * The statement binds that witness to the locked row; a forged/stale witness cannot commit.
 * No database reads happen here. Resource resolution remains the existing publisher contract.
 */
export async function planStructure(base,operations,context,body={}){
 assert.equal(typeof context?.loadRef,'function');
 const before=base.document.tree,observed=base.document.prose;
 let tree=applyOperations(clone(before),operations);
 const projected=project(tree,observed);tree=projected.tree;
 const projectedInput=projectedSource(tree);
 body={theme:base.meta.theme??null,template:base.meta.template??null,colorMode:base.meta.colorMode??null,...body};
 let published=await publish(body,projectedInput.source,context);
 if(published instanceof Response&&published.status!==413)return published;
 try{if(published instanceof Response)throw new Error('Projection exceeds source cap');tree=recoverTree(published.source,projectedInput.markers);}catch{
  // Complete vocabulary escape hatch: materialize context at boundaries the canonicalizer
  // changes. This still commits once, but all consumed values become dependencies.
  const full=clone(projected.tree);walk(full,n=>{if(n.slot){const found=projected.fresh[n.slot]??observed[n.slot];assert.ok(found);if(observed[n.slot])projected.consumed.add(n.slot);n.value=found.value;delete n.slot;}});
  published=await publish(body,decodeSource(full),context);if(published instanceof Response)return published;
  tree=encodeSource(published.source);
 }
 const previous=new Set(ids(before)),remaining=new Set(ids(tree));
 const removed=[...previous].filter(id=>!remaining.has(id));
 const fresh=Object.fromEntries(Object.entries(projected.fresh).filter(([id])=>remaining.has(id)));
 const reads=[...new Set([...removed,...projected.consumed])];
 // Public encoded ASTs are never accepted without parser/publisher round-trip. A slot is
 // internal only; all retained slot IDs originate in this hash-bound baseline.
 for(const id of remaining)assert.ok(previous.has(id)||fresh[id]);
 const patches=diff(before,tree);
 return certificate({id:base.id,expectedMeta:base.meta,baseVersion:base.version,epoch:base.epoch,hash:fingerprint(before),tree,patches:patches.length>48?[{path:[],value:tree}]:patches,fixedDelta:fixedBytes(tree)-fixedBytes(before),removed,fresh,reads,observed,meta:published.meta});
}

/** Unversioned reference schemas/permissions and font resolution MUST be checked again.
 * Their current state is not certified by the artifact row. Revalidate the semantic
 * context outside the write, then bind that context to the one atomic commit. */
export async function planProse(base,{slot,oldText,newText},context){
 assert.ok(safe(oldText)&&safe(newText),'Needs semantic operation');
 assert.equal(typeof context?.loadRef,'function');
 const body={theme:base.meta.theme??null,template:base.meta.template??null,colorMode:base.meta.colorMode??null};
 let published=await publish(body,projectedSource(base.document.tree).source,context);
 if(published instanceof Response&&published.status===413){
  assert.ok(Object.values(base.document.prose).every(p=>safe(p.value)));
  published=await publish(body,renderState(base.document),context);
 }
 if(published instanceof Response)return published;
 if(!isDeepStrictEqual(published.meta,base.meta))return new Response(JSON.stringify({error:'validation_context_changed'}),{status:409});
 return certificate({kind:'contextualText',id:base.id,base:base.version,epoch:base.epoch,hash:fingerprint(base.document.tree),meta:base.meta,slot,oldText,newText});
}

export function createSemanticState(source,meta){
 const projected=project(encodeSource(source),{});
 const document={tree:projected.tree,prose:Object.fromEntries(Object.entries(projected.fresh).map(([id,v])=>[id,{...v,revision:1}]))};
 assert.equal(renderState(document),source);
 return {document,contextRequired:needsContext(document.tree,meta)};
}

export async function createKernel(pool,context,{actorId='mxmx_test_semantic'}={}){
 await pool.query(`CREATE TABLE IF NOT EXISTS semantic_documents(id text PRIMARY KEY,version int NOT NULL,epoch int NOT NULL,semantic_hash text NOT NULL,document jsonb NOT NULL,source_bytes int NOT NULL,meta jsonb NOT NULL,archived_at timestamptz,owner_id text NOT NULL,context_required boolean NOT NULL);
 CREATE TABLE IF NOT EXISTS semantic_history(id text,version int,document jsonb,meta jsonb,PRIMARY KEY(id,version));
 CREATE TABLE IF NOT EXISTS semantic_edits(id text,version int,operation jsonb,PRIMARY KEY(id,version));`);
 const compilerVersion=storyCssCompileVersion();
 const read=async id=>(await pool.query('SELECT * FROM semantic_documents WHERE id=$1 AND owner_id=$2',[id,actorId])).rows[0];
 const create=async(id,source,body={})=>{
  const result=await publish(body,source,context);if(result instanceof Response)return result;
  const projected=project(encodeSource(result.source),{}),document={tree:projected.tree,prose:Object.fromEntries(Object.entries(projected.fresh).map(([id,v])=>[id,{...v,revision:1}]))};
  assert.equal(renderState(document),result.source);
  return (await pool.query('INSERT INTO semantic_documents(id,version,epoch,semantic_hash,document,source_bytes,meta,owner_id,context_required) VALUES($1,1,1,$2,$3::jsonb,$4,$5::jsonb,$6,$7) RETURNING *',[id,fingerprint(document.tree),JSON.stringify(document),bytes(result.source),JSON.stringify(result.meta),actorId,needsContext(document.tree,result.meta)])).rows[0];
 };
 const textInternal=async(id,{base,epoch,slot,oldText,newText},prepared=null)=>{
  assert.ok([base,epoch].every(Number.isSafeInteger)&&base>=1&&epoch>=1);assert.ok(safe(oldText)&&safe(newText),'Needs semantic operation');
  const delta=bytes(raw(newText))-bytes(raw(oldText));
  const result=await pool.query(`WITH updated AS (
   UPDATE semantic_documents SET document=jsonb_set(document,ARRAY['prose',$2],jsonb_build_object('value',$4::text,'bytes',$7::int,'revision',version+1),false),source_bytes=source_bytes+$8,archived_at=CASE WHEN archived_at IS NULL OR archived_at<=now()-interval '120 seconds' THEN now() ELSE archived_at END,version=version+1
   WHERE id=$1 AND owner_id=$9 AND version>=$5 AND epoch=$6 AND document->'prose' ? $2
    AND document#>>ARRAY['prose',$2,'value']=$3 AND (document#>>ARRAY['prose',$2,'revision'])::int<=$5
    AND source_bytes+$8 BETWEEN 0 AND 2000000 AND ($10::boolean OR NOT context_required)
    AND (NOT $10::boolean OR (semantic_hash=$11 AND meta=$12::jsonb)) AND meta->>'cssCompileVersion'=$13
   RETURNING WITH (OLD AS o,NEW AS n) n.*,o.document previous_document,o.meta previous_meta,o.version previous_version,o.archived_at previous_archived_at
  ), archive AS (INSERT INTO semantic_history SELECT id,previous_version,previous_document,previous_meta FROM updated WHERE previous_archived_at IS NULL OR previous_archived_at<=now()-interval '120 seconds'), logged AS (
   INSERT INTO semantic_edits SELECT id,version,jsonb_build_object('kind','text','slot',$2::text,'before',$3::text,'after',$4::text) FROM updated RETURNING pg_notify('semantic_'||id,version::text)
  ) SELECT id,version,epoch,semantic_hash,document,source_bytes,meta,archived_at,owner_id,context_required FROM updated WHERE EXISTS(SELECT 1 FROM logged)`,[id,slot,oldText,newText,base,epoch,bytes(raw(newText)),delta,actorId,!!prepared,prepared?.hash??null,prepared?JSON.stringify(prepared.meta):null,compilerVersion]);
  return result.rows[0]??null;
 };
 const commit=async(id,token)=>{
  const op=admitted.get(token);assert.ok(op,'Unvalidated operation');assert.equal(id,op.id,'Certificate belongs to another document');
  const params=[id,op.baseVersion,op.epoch,op.hash,JSON.stringify(op.meta),fingerprint(op.tree),JSON.stringify(op.expectedMeta),actorId];
  const param=value=>{params.push(value);return `$${params.length}`;};
  let expression='document';
  for(const patch of op.patches){const path=param(['tree',...patch.path]),value=param(JSON.stringify(patch.value));expression=`jsonb_set(${expression},${path}::text[],${value}::jsonb,false)`;}
  let prose="(document->'prose')",delta=String(op.fixedDelta);const guards=[];
  for(const slot of op.reads){const p=param(slot);guards.push(`(document#>>ARRAY['prose',${p},'revision'])::int<=$2`);if(op.observed[slot])guards.push(`document#>>ARRAY['prose',${p},'value']=${param(op.observed[slot].value)}::text`);}
  for(const slot of op.removed){const p=param(slot);prose=`(${prose}-${p}::text)`;delta+=`-((document#>>ARRAY['prose',${p},'bytes'])::int)`;}
  for(const [slot,value] of Object.entries(op.fresh)){prose=`(${prose}||jsonb_build_object(${param(slot)}::text,jsonb_build_object('value',${param(value.value)}::text,'bytes',${param(value.bytes)}::int,'revision',version+1)))`;delta+=`+${value.bytes}`;}
  expression=`jsonb_set(${expression},'{prose}',${prose},false)`;
  const logged=param(JSON.stringify({kind:'semantic',patches:op.patches,removed:op.removed,fresh:op.fresh,meta:op.meta}));
  const result=await pool.query(`WITH updated AS (
   UPDATE semantic_documents SET document=${expression},source_bytes=source_bytes+(${delta}),meta=$5::jsonb,semantic_hash=$6,context_required=${needsContext(op.tree,op.meta)?'true':'false'},archived_at=CASE WHEN archived_at IS NULL OR archived_at<=now()-interval '120 seconds' THEN now() ELSE archived_at END,version=version+1,epoch=epoch+1
   WHERE id=$1 AND owner_id=$8 AND version>=$2 AND epoch=$3 AND semantic_hash=$4 AND meta=$7::jsonb ${guards.length?'AND '+guards.join(' AND '):''}
    AND source_bytes+(${delta}) BETWEEN 0 AND 2000000
   RETURNING WITH (OLD AS o,NEW AS n) n.*,o.document previous_document,o.meta previous_meta,o.version previous_version,o.archived_at previous_archived_at
  ), archive AS (INSERT INTO semantic_history SELECT id,previous_version,previous_document,previous_meta FROM updated WHERE previous_archived_at IS NULL OR previous_archived_at<=now()-interval '120 seconds'), logged AS (
   INSERT INTO semantic_edits SELECT id,version,${logged}::jsonb FROM updated RETURNING pg_notify('semantic_'||id,version::text)
  ) SELECT id,version,epoch,semantic_hash,document,source_bytes,meta,archived_at,owner_id,context_required FROM updated WHERE EXISTS(SELECT 1 FROM logged)`,params);
  return result.rows[0]??null;
 };
 const text=(id,input)=>textInternal(id,input);
 const preparedText=(id,token)=>{const op=admitted.get(token);assert.ok(op?.kind==='contextualText','Unvalidated contextual text');assert.equal(id,op.id);return textInternal(id,op,op);};
 return {create,read,text,preparedText,commit};
}
