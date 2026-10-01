/** A whole replacement consumes an observed version, including recovery from a
 * damaged head. It never traverses or decodes the previous document. */
import type {DocumentGraph} from '@artifactbin/contracts';
export function documentReplacementSql(document:DocumentGraph,baseVersion:number,initial:unknown[]){
 const params=[...initial,JSON.stringify(document),baseVersion];
 const candidate=`$${initial.length+1}::jsonb`,version=`$${initial.length+2}::int`;
 return {params,guard:`l.version=${version}`,
  expression:`(${candidate}||jsonb_build_object('nodes',(SELECT jsonb_object_agg(key,value||jsonb_build_object('selfVersion',l.version+1,'childrenVersion',l.version+1,'subtreeVersion',l.version+1)) FROM jsonb_each(${candidate}->'nodes')),
   'claimedIds',(CASE WHEN jsonb_typeof(l.document->'claimedIds')='object' THEN l.document->'claimedIds' ELSE '{}'::jsonb END)||COALESCE((SELECT jsonb_object_agg(id,l.version+1) FROM jsonb_object_keys(${candidate}->'claimedIds') id),'{}'::jsonb)))`};
}
