/**
 * One-off repairs for an HTML head saved before registered programs were re-bound on save: each registry
 * plans the re-binding (registered-page-queries/registry, registered-page-mutations/registry); this module
 * locks the head and writes its links, which the artifacts table's owner does. Returns the re-bound
 * namespaces; an already valid or unregistered page is left untouched.
 */
import type { Queryable } from '@artifactbin/contracts';
import { planRegisteredMutationRepair } from '../registered-page-mutations/registry';
import { planRegisteredQueryRepair, type RegisteredRepair, type RepairableHead } from '../registered-page-queries/registry';

async function repairHead(tx: Queryable, pageId: string, plan: (tx: Queryable, head: RepairableHead) => Promise<RegisteredRepair | null>): Promise<string[]> {
  const head = (await tx.query<Omit<RepairableHead, 'source'> & { source: string | null; format: string }>(
    'SELECT id,user_id,version,source,format,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [pageId],
  )).rows[0];
  if (!head || head.format !== 'html' || head.source === null) throw Error('page_unavailable');
  const repair = await plan(tx, { ...head, source: head.source });
  if (!repair) return [];
  await tx.query("UPDATE artifacts SET meta=jsonb_set(meta,'{htmlLinks}',$2::jsonb) WHERE id=$1 AND version=$3", [pageId, JSON.stringify(repair.links), head.version]);
  return repair.commit();
}

export const repairRegisteredQueryHead = (tx: Queryable, pageId: string): Promise<string[]> => repairHead(tx, pageId, planRegisteredQueryRepair);
export const repairRegisteredMutationHead = (tx: Queryable, pageId: string): Promise<string[]> => repairHead(tx, pageId, planRegisteredMutationRepair);
