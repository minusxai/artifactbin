/** Receipt-only metadata recovery. No writer actor, publication refresh or link-derived access.
 * JSON equality binds every execution field; namespace alone spans sibling executions.
 * Callers must fence this read with current service reader admission and reread after the final fence.
 */
import type {WorkloadBinding,ArtifactWorkloadOutputPage} from '@artifactbin/contracts';
import {getDb,PUBLIC_BASE_URL} from '@/lib/platform';
export async function readWorkloadOutputPage(principal:WorkloadBinding,after:string|null):Promise<ArtifactWorkloadOutputPage>{
 const {rows}=await (await getDb()).query<{id:string;title:string;format:string}>(`
  SELECT DISTINCT a.id COLLATE "C" AS id,a.title,a.format
  FROM workload_publication_audit audit
  JOIN workload_publication_outputs output ON output.namespace=audit.namespace AND output.artifact_id=audit.artifact_id
  JOIN artifacts a ON a.id=output.artifact_id
  JOIN groups g ON g.id=a.group_id AND g.deleted_at IS NULL
  WHERE audit.binding=$1::jsonb AND audit.group_id=$2 AND a.group_id=$2
   AND a.deleted_at IS NULL AND ($3::text IS NULL OR a.id COLLATE "C">$3::text COLLATE "C")
  ORDER BY 1 LIMIT 51`,[JSON.stringify(principal),principal.groupId,after]);
 const hasMore=rows.length>50,items=rows.slice(0,50).map(row=>({...row,url:new URL('/a/'+row.id,PUBLIC_BASE_URL).href}));
 return {items,nextCursor:hasMore?items.at(-1)!.id:null,hasMore};
}
