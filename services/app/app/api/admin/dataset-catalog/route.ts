import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
import { hasAdminCredential } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http';
import { runDatasetCatalogMigrationBatch } from '@/lib/datasets/migrate';
import { refLoaderForActor, writerFor, type ArtifactRow } from '@/lib/artifacts';
import { checkDocumentData } from '@/lib/story/data-checks';

const KEYS = new Set(['batchSize','dryRun','maxHistoricalVersionsPerArtifact','after','expected']);
export async function POST(request: Request): Promise<Response> {
  if (!hasAdminCredential(request)) return json({error:'not_found'},404);
  const body=await request.json().catch(()=>null) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid_migration_request'},400);
  const input=body as Record<string,unknown>;
  if (Object.keys(input).some((key)=>!KEYS.has(key))) return json({error:'invalid_migration_request'},400);
  if (!Number.isInteger(input.batchSize) || (input.batchSize as number)<1 || (input.batchSize as number)>100) return json({error:'invalid_batch_size'},400);
  if (input.dryRun!==undefined && typeof input.dryRun!=='boolean') return json({error:'invalid_dry_run'},400);
  if(input.after!==undefined && (typeof input.after!=='string'||!ARTIFACT_ID_PATTERN.test(input.after)))return json({error:'invalid_cursor'},400);
  const expected=input.expected;
  if(expected!==undefined && (!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length>(input.batchSize as number)||Object.entries(expected).some(([id,hash])=>!ARTIFACT_ID_PATTERN.test(id)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))))return json({error:'invalid_snapshot'},400);
  if(input.dryRun===false && expected===undefined)return json({error:'reviewed_snapshot_required'},400);
  const cap=input.maxHistoricalVersionsPerArtifact;
  if (cap!==undefined && (!Number.isInteger(cap)||(cap as number)<0||(cap as number)>10_000)) return json({error:'invalid_history_limit'},400);
  const report=await runDatasetCatalogMigrationBatch(await getDb(),{
    ...(input.after===undefined?{}:{after:input.after as string}),...(expected===undefined?{}:{expected:expected as Record<string,string>}),
    batchSize:input.batchSize as number,dryRun:input.dryRun === false ? false : true,
    ...(cap===undefined?{}:{maxHistoricalVersionsPerArtifact:cap as number}),
    validate: async(source,row)=>{const checked=await checkDocumentData(source,refLoaderForActor(writerFor(row as unknown as ArtifactRow)));return checked.ok?[]:checked.details;},
  });
  return report.conflicts.length ? json({error:'migration_conflict',incomplete:true,...report},409) : json(report);
}
