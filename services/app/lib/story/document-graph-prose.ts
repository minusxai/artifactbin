/** The inert-text contract lowers directly to SQL. The database, not the client,
 * supplies the certified node, ancestry, revisions and UTF-16 history position. */
import {inertProse,proseSource,type ProseOperation} from './document-prose';
import {MAX_CONTENT_BYTES} from './input';
import {GRAPH_ROOT} from './document-graph';
export function graphProseSql(document:string,version:string,baseEditId:string,op:ProseOperation,initial:unknown[]){
 if(!inertProse(op.oldText)||!inertProse(op.newText)||!op.newText.length||op.oldText===op.newText||!Array.isArray(op.path)||op.path.length>258||op.path[0]!=='roots'||op.path.at(-1)!=='value')return null;
 const path:number[]=[];
 for(let index=1;index<op.path.length-1;index+=2){
  const part=op.path[index];if(typeof part!=='string'||!/^(0|[1-9]\d*)$/.test(part)||Number(part)>2147483647||index+1<op.path.length-1&&op.path[index+1]!=='children')return null;
  path.push(Number(part));
 }
 if(!path.length||op.path.length!==path.length*2+1)return null;
 const params=[...initial],param=(value:unknown)=>{params.push(value);return `$${params.length}`;};
 const indices=param(path),base=param(baseEditId),oldText=param(op.oldText),newText=param(op.newText),before=proseSource(op.oldText),after=proseSource(op.newText);
 const removed=param(before),inserted=param(after),units=param(after.length),byteSize=param(Buffer.byteLength(after)),unitDelta=param(after.length-before.length),byteDelta=param(Buffer.byteLength(after)-Buffer.byteLength(before)),oldUnits=param(before.length),limit=param(MAX_CONTENT_BYTES);
 const nodes=`(${document}->'nodes')`,contextRef='l.mutation_context';
 const context=`(WITH RECURSIVE base AS (
   SELECT (document_state->>'version')::int AS version FROM artifact_edits WHERE artifact_id=$1 AND edit_id=${base}
  ), walk(key,depth,position,keys) AS (
   SELECT '${GRAPH_ROOT}'::text,0,0,ARRAY['${GRAPH_ROOT}']::text[] FROM base WHERE ${version}-base.version BETWEEN 0 AND 200
   UNION ALL
   SELECT child.key,w.depth+1,w.position
    +COALESCE((SELECT sum(value::int)::int FROM jsonb_array_elements_text(n.value->'partUnits') WITH ORDINALITY p(value,ordinal) WHERE ordinal<=(${indices}::int[])[w.depth+1]+1),0)
    +COALESCE((SELECT sum((${nodes}->s.key->>'subtreeUnits')::int)::int FROM jsonb_array_elements_text(n.value->'children') WITH ORDINALITY s(key,ordinal) WHERE ordinal<=(${indices}::int[])[w.depth+1]),0),
    w.keys||child.key
   FROM walk w CROSS JOIN base CROSS JOIN LATERAL (SELECT ${nodes}->w.key AS value) n
   CROSS JOIN LATERAL (SELECT n.value->'children'->>((${indices}::int[])[w.depth+1]) AS key) child
   WHERE w.depth<cardinality(${indices}::int[]) AND child.key IS NOT NULL
    AND (n.value->>'selfVersion')::int<=base.version AND (n.value->>'childrenVersion')::int<=base.version
  ) SELECT jsonb_build_object('key',w.key,'keys',w.keys,'position',w.position)
    FROM walk w CROSS JOIN base CROSS JOIN LATERAL (SELECT ${nodes}->w.key AS value) n
    WHERE w.depth=cardinality(${indices}::int[]) AND n.value->>'prose'='true'
     AND (n.value->>'selfVersion')::int<=base.version AND n.value#>>'{ast,roots,0,value}'=${oldText}::text)`;
 const expression=`(${document}||jsonb_build_object('bytes',(${document}->>'bytes')::int+${byteDelta}::int,'nodes',${nodes}||(
   SELECT jsonb_object_agg(k.key,n.value||jsonb_build_object('subtreeUnits',(n.value->>'subtreeUnits')::int+${unitDelta}::int,'subtreeVersion',${version}+1)
    ||CASE WHEN k.key=${contextRef}->>'key' THEN jsonb_build_object('ast',jsonb_set(n.value->'ast','{roots,0,value}',to_jsonb(${newText}::text),false),'parts',jsonb_build_array(${inserted}::text),'partUnits',jsonb_build_array(${units}::int),'units',${units}::int,'bytes',${byteSize}::int,'selfVersion',${version}+1) ELSE '{}'::jsonb END)
   FROM jsonb_array_elements_text(${contextRef}->'keys') k(key) CROSS JOIN LATERAL (SELECT ${nodes}->k.key AS value) n)))`;
 const start=`(${contextRef}->>'position')::int`;
 return {params,context,expression,guard:`${contextRef} IS NOT NULL AND (${document}->>'bytes')::int+${byteDelta}::int BETWEEN 0 AND ${limit}::int`,history:{start,removed:`${removed}::text`,inserted:`${inserted}::text`,end:`${start}+${oldUnits}::int`}};
}
