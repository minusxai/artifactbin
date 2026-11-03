import type { GrantDocument } from '@/lib/artifact-access';
import { commitDatasetPolicy, type ArtifactRow, getArtifactById, getArtifactFor } from '@/lib/artifacts';
import type { DatasetPermissions } from '@artifactbin/contracts';
import { validateDatasetPolicyForRow, catalogOf } from '@/lib/datasets';
import { datasetWriteAccess, type DatasetWriteOptions } from '@/lib/dataset-permissions';
import { getDb } from '@/lib/platform';
import type { AccessActor } from '@/lib/accounts';

export async function setDatasetPolicy(
  actor: AccessActor,
  id: string,
  value: unknown,
  revision: number,
): Promise<
  { revision: number; policy: DatasetPermissions | null } | { conflict: true } | null
> {
  const row = await getArtifactFor(actor, id);
  if (!row || row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres')
    return null;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('expectedPolicyRevision must be a nonnegative integer');
  const policy = validateDatasetPolicyForRow(row,value);
  const committed = await commitDatasetPolicy(await getDb(), actor, row, policy, revision);
  return committed === null ? { conflict: true } : { revision: committed, policy };
}
/** How a write door reaches the dataset: false = the direct door, true = through a page that names no page id, a document = its program, a page id = the page's generated API. */
export type WriteDoor = boolean | GrantDocument | { pageId: string };
const doorOptions = (declared: WriteDoor): DatasetWriteOptions =>
  typeof declared !== 'object' ? { throughPage: declared } : 'pageId' in declared ? { pageId: declared.pageId, throughPage: true } : { document: declared, throughPage: true };

/** Re-read the head: the same policy revision, and the caller may still write through this door. */
export async function recheckMutation(
  dataset: ArtifactRow,
  actor: AccessActor,
  declared: WriteDoor = false,
): Promise<ArtifactRow> {
  const current = await getArtifactById(dataset.id);
  if (
    !current ||
    (current.policy_revision ?? 0) !== (dataset.policy_revision ?? 0) ||
    !(await datasetWriteAccess(current, actor, doorOptions(declared))).allowed
  )
    throw new Error('Mutation permission changed');
  return current;
}

// ── Writable datasets ────────────────────────────────────────────────────────

/** Why a write may not happen. Each names the fix; none is an existence oracle. */
export type WriteRefusal = 'not_a_dataset' | 'dataset_read_only';

/**
 * May this actor write the dataset at all through this door: owner and editors (under the `access` ceiling),
 * or a role with a v3 rule it can use (lib/dataset-permissions).
 */
export async function canWriteDataset(dataset: ArtifactRow, actor: AccessActor, declared: WriteDoor = false): Promise<WriteRefusal | null> {
  if (dataset.format !== 'dataset') return 'not_a_dataset';
  // An unreachable dataset is reported as read-only, never as "not yours":
  // the caller answers a uniform 404 for anything it could not resolve, and
  // this one it could — the document names it, so its existence is not news.
  return (await datasetWriteAccess(dataset, actor, doorOptions(declared))).allowed ? null : 'dataset_read_only';
}
