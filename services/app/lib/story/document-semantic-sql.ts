/** SQL compilation has no public JSON-patch capability: only an admitted token
 * can produce a plan. Column expressions are server-owned identifiers. Values,
 * paths, dependency witnesses and layouts are always bound parameters. */
import {semanticPlan,type SemanticAdmission} from './document-semantic';
import {documentPatchSql} from './document-patch';
import {MAX_CONTENT_BYTES} from './input';
export function semanticOperationSql(document:string,version:string,meta:string,token:SemanticAdmission,initial:unknown[]):{expression:string;guard:string;params:unknown[]}{
 const plan=semanticPlan(token),tree=documentPatchSql(`(${document}->'tree')`,plan.patches,initial),params=tree.params;
 const param=(value:unknown)=>{params.push(value);return `$${params.length}`;};
 const epoch=param(plan.epoch),hash=param(plan.hash),base=param(plan.baseVersion),expectedMeta=param(JSON.stringify(plan.expectedMeta));
 const removed=param(plan.removed),fresh=param(JSON.stringify(plan.fresh)),layout=param(JSON.stringify(plan.layout));
 const dependencies=param(JSON.stringify(plan.reads.map(slot=>({slot,value:plan.observed[slot]!.value}))));
 const fixed=param(plan.fixedDelta),nextEpoch=param(plan.nextEpoch),nextHash=param(plan.nextHash),limit=param(MAX_CONTENT_BYTES);
 const oldProse=`(${document}->'prose')`;
 const delta=`(${fixed}::int-COALESCE((SELECT sum((entry.value->>'bytes')::int) FROM jsonb_each(${oldProse}) entry WHERE entry.key=ANY(${removed}::text[])),0)+COALESCE((SELECT sum((entry.value->>'bytes')::int) FROM jsonb_each(${fresh}::jsonb) entry),0))`;
 const nextProse=`COALESCE((SELECT jsonb_object_agg(entry.key,entry.value||COALESCE(${layout}::jsonb->entry.key,'{}'::jsonb)||CASE WHEN ${fresh}::jsonb ? entry.key THEN jsonb_build_object('revision',${version}+1) ELSE '{}'::jsonb END) FROM jsonb_each((${oldProse}-${removed}::text[])||${fresh}::jsonb) entry),'{}'::jsonb)`;
 const expression=`(${document}||jsonb_build_object('tree',${tree.expression},'prose',${nextProse},'bytes',(${document}->>'bytes')::int+${delta},'epoch',${nextEpoch}::text,'hash',${nextHash}::text,'contextRequired',${plan.contextRequired?'true':'false'}))`;
 const guard=`${document}->>'epoch'=${epoch} AND ${document}->>'hash'=${hash}
 AND ${version}-${base}::int BETWEEN 0 AND 200
 AND (${meta}-'parsedArtifact')=(${expectedMeta}::jsonb-'parsedArtifact')
 AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${dependencies}::jsonb) dep(slot text,value text)
   WHERE NOT (${oldProse} ? dep.slot) OR (${oldProse}->dep.slot->>'revision')::int>${base}::int
    OR (${oldProse}->dep.slot->>'value') IS DISTINCT FROM dep.value)
 AND (${document}->>'bytes')::int+${delta} BETWEEN 0 AND ${limit}::int`;
 return {expression,guard,params};
}
