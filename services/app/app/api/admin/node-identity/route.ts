/** Admin-only bounded migration invocation. No anonymous/agent capability. */
import { hasAdminCredential } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http';
import { runNodeIdentityMigrationBatch } from '@/lib/node-identity-migration';

const KEYS=new Set(['batchSize','dryRun','maxHistoricalVersionsPerArtifact']);

export async function POST(request: Request): Promise<Response> {
  // Authenticate before parsing input or opening the database: to everyone
  // else this operational surface does not exist.
  if (!hasAdminCredential(request)) return json({error:'not_found'},404);
  const body=await request.json().catch(()=>null) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid_migration_request'},400);
  const input=body as Record<string,unknown>;
  if (Object.keys(input).some(key=>!KEYS.has(key))) return json({error:'invalid_migration_request'},400);
  if (!Number.isInteger(input.batchSize) || (input.batchSize as number)<1 || (input.batchSize as number)>100) return json({error:'invalid_batch_size'},400);
  if (input.dryRun!==undefined && typeof input.dryRun!=='boolean') return json({error:'invalid_dry_run'},400);
  const cap=input.maxHistoricalVersionsPerArtifact;
  if (cap!==undefined && (!Number.isInteger(cap) || (cap as number)<0 || (cap as number)>10_000)) return json({error:'invalid_history_limit'},400);
  const report=await runNodeIdentityMigrationBatch(await getDb(),{
    batchSize:input.batchSize as number,
    ...(input.dryRun===undefined?{}:{dryRun:input.dryRun}),
    ...(cap===undefined?{}:{maxHistoricalVersionsPerArtifact:cap as number}),
  });
  if (report.conflicts.length) return json({error:'migration_conflict',incomplete:true,...report},409);
  return json(report);
}
