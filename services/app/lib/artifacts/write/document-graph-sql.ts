/** SQL lowering for internal graph patches. The writer accepts only publication
 * admissions; clients cannot submit these SQL paths, fragments or revision sets.
 */
import {GRAPH_POLICY,GRAPH_ROOT} from '../../document/document-graph';
import type {GraphPatch} from '../../document/document-graph-patch';
import {documentPatchStepSql} from '../../document/document-patch';
import {MAX_DOCUMENT_BYTES} from '@artifactbin/contracts';

export function graphPatchSql(document:string,version:string,patch:GraphPatch,initial:unknown[]):{expression:string;guard:string;integrity:(next:string)=>string;params:unknown[]} {
  const params=[...initial];
  const param=(value:unknown)=>{params.push(value);return `$${params.length}`;};
  const reads=param(JSON.stringify(patch.reads)),inserted=param(JSON.stringify(patch.inserted)),removed=param(patch.removed),updated=param(JSON.stringify(patch.updated)),touched=param(patch.touched),delta=param(patch.byteDelta),base=param(patch.baseVersion),limit=param(MAX_DOCUMENT_BYTES),policy=param(GRAPH_POLICY);
  const selections=param(JSON.stringify(patch.selections)),unitDeltas=param(JSON.stringify(patch.unitDeltas)),claims=param(JSON.stringify(patch.claims));
  const nodes=`(${document}->'nodes')`;
  // One node by path: `nodes->key` would first copy the whole node map (megabytes) out of the document, per reference.
  const node=(key:string)=>`(${document}#>ARRAY['nodes',${key}])`;
  // LATERAL stages are rescanned against PostgreSQL's locked-row recheck.
  // A recursive CTE here can retain its pre-wait work table during EvalPlanQual.
  const stages=Array.from({length:Math.max(0,...Object.values(patch.updated).map(write=>write.patches.length))},(_,step)=>{
    const previous=step?`s${step-1}.value`:'n.value';
    return `CROSS JOIN LATERAL (SELECT CASE WHEN ${step}<jsonb_array_length(n.patches)
      THEN ${documentPatchStepSql(previous,`(n.patches->${step})`)} ELSE ${previous} END AS value OFFSET 0) s${step}`;
  });
  const value=stages.length?`s${stages.length-1}.value`:'n.value';
  const replacement=`((${nodes}-${removed}::text[])||COALESCE((SELECT jsonb_object_agg(n.key,${value}
    ||jsonb_build_object('subtreeUnits',(${value}->>'subtreeUnits')::int+COALESCE((${unitDeltas}::jsonb->>n.key)::int,0))
    ||CASE WHEN ${inserted}::jsonb ? n.key OR (n.flags->>'self')::boolean THEN jsonb_build_object('selfVersion',${version}+1) ELSE '{}'::jsonb END
    ||CASE WHEN ${inserted}::jsonb ? n.key OR (n.flags->>'children')::boolean THEN jsonb_build_object('childrenVersion',${version}+1) ELSE '{}'::jsonb END
    ||jsonb_build_object('subtreeVersion',${version}+1))
    FROM (SELECT key,COALESCE(${inserted}::jsonb->key,${node('key')}) AS value,
      COALESCE(${updated}::jsonb->key->'patches','[]'::jsonb) AS patches,${updated}::jsonb->key AS flags
      FROM unnest(${touched}::text[]) key) n
    ${stages.join('\n')}),'{}'::jsonb))`;
  // Every jsonb construction walks and re-serializes all it keeps, so the document is rebuilt ONCE, around the new node
  // map: the keys it rewrites are dropped first (the old map is skipped, not walked) and the map is set last. Concatenating
  // the whole document with a new object would walk the old map and the new one, then discard the old.
  const expression=`jsonb_set((${document}-'nodes'-'claimedIds'-'bytes')||jsonb_build_object('claimedIds',(${document}->'claimedIds')||COALESCE((SELECT jsonb_object_agg(c.id,${version}+1) FROM jsonb_to_recordset(${claims}::jsonb) c(id text,version int)),'{}'::jsonb),'bytes',(${document}->>'bytes')::int+${delta}::int),'{nodes}',${replacement},true)`;
  const guard=`${document}->>'policy'=${policy} AND ${document}->>'kind'='graph'
    AND ${version}-${base}::int BETWEEN 0 AND 200
    AND (${document}->>'bytes')::int+${delta}::int BETWEEN 0 AND ${limit}::int
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${claims}::jsonb) c(id text,version int) WHERE (${document}->'claimedIds'->>c.id)::int IS DISTINCT FROM c.version)
    AND (jsonb_array_length(${selections}::jsonb)=0 OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${selections}::jsonb) s(selector text,keys jsonb)
      LEFT JOIN (SELECT sel AS selector,jsonb_agg(n.key ORDER BY n.key) AS keys
        FROM jsonb_each(${nodes}) n CROSS JOIN LATERAL unnest(ARRAY(SELECT x->>'selector' FROM jsonb_array_elements(${selections}::jsonb) x)) sel
        WHERE (n.value->'selectors') ? sel GROUP BY sel) found ON found.selector=s.selector
      WHERE s.keys IS DISTINCT FROM COALESCE(found.keys,'[]'::jsonb)))
    AND NOT (${nodes} ?| ARRAY(SELECT jsonb_object_keys(${inserted}::jsonb)))
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${reads}::jsonb) r(key text,facet text,version int)
      WHERE ${node('r.key')} IS NULL OR (${document}#>>ARRAY['nodes',r.key,r.facet])::int IS DISTINCT FROM r.version)`;
  // The patch is client-prepared, so the document it produces is checked before it is stored: over the nodes the
  // patch writes only (never the whole graph). Each must exist as an object, have one more part than children, name
  // children that exist in the new map and point back at it; and the byte delta must equal the touched nodes' change.
  // `CASE` keeps a malformed value a refusal, never a cast error.
  const integrity=(next:string)=>`NOT EXISTS(SELECT 1 FROM unnest(${touched}::text[]) k CROSS JOIN LATERAL (SELECT ${next}#>ARRAY['nodes',k] AS v) n
      WHERE CASE WHEN jsonb_typeof(n.v) IS DISTINCT FROM 'object' OR jsonb_typeof(n.v->'children') IS DISTINCT FROM 'array' OR jsonb_typeof(n.v->'parts') IS DISTINCT FROM 'array' OR jsonb_typeof(n.v->'bytes') IS DISTINCT FROM 'number' THEN TRUE
        ELSE jsonb_array_length(n.v->'parts')<>jsonb_array_length(n.v->'children')+1
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(n.v->'children') c WHERE jsonb_typeof(${next}#>ARRAY['nodes',c]) IS DISTINCT FROM 'object' OR ${next}#>>ARRAY['nodes',c,'parent'] IS DISTINCT FROM k) END)
    AND (SELECT COALESCE(sum((${next}#>>ARRAY['nodes',k,'bytes'])::numeric),0) FROM unnest(${touched}::text[]) k)
      -(SELECT COALESCE(sum((${document}#>>ARRAY['nodes',k,'bytes'])::numeric),0) FROM unnest(${touched}::text[]||${removed}::text[]) k)=${delta}::numeric`;
  return {expression,guard,integrity,params};
}

/** Serialize server-generated fragments in tree order. jsonb_each extracts the
 * map once; recursive traversal visits each reachable node once. This is used
 * for the exact locked preimage and committed history, never for admission. */
const graphWalkSql=(document:string)=>`WITH RECURSIVE entries AS MATERIALIZED (
      SELECT key,value FROM jsonb_each((${document})->'nodes')
    ), walk(key,path) AS (
      SELECT '${GRAPH_ROOT}'::text,ARRAY[]::int[]
      UNION ALL
      SELECT child.key,walk.path||((child.ordinal-1)*2+1)::int FROM walk
      JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements_text(n.value->'children') WITH ORDINALITY child(key,ordinal)
    )`;
export function graphSourceSql(document:string):string {
  return `(${graphWalkSql(document)} SELECT COALESCE(string_agg(part.value,'' ORDER BY walk.path||((part.ordinal-1)*2)::int),'')
      FROM walk JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements_text(n.value->'parts') WITH ORDINALITY part(value,ordinal))`;
}
export function graphReferencesSql(document:string):string {
  return `(${graphWalkSql(document)}, reference_list AS (
      SELECT DISTINCT ON (ref.value->>'id') ref.value,walk.path,ref.ordinal
      FROM walk JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements(n.value->'refs') WITH ORDINALITY ref(value,ordinal)
      ORDER BY ref.value->>'id',walk.path,ref.ordinal
    ) SELECT COALESCE(jsonb_agg(value ORDER BY path,ordinal),'[]'::jsonb) FROM reference_list)`;
}
