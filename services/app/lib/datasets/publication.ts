/** Dataset content and settings at the artifact publication, replacement and restore boundaries. */
import type {ArtifactFormat} from '@artifactbin/contracts/artifact-format';
import type {DatasetAccess} from '@artifactbin/contracts/sharing';
import type {DatasetColumn} from '@artifactbin/contracts/sql';
import type {Queryable} from '@artifactbin/contracts/db';
import {reply} from '@/lib/http';
import {catalogOf} from './catalog';
import {liveConnectionOf} from './catalog-metadata';
import {loadDatasetRows} from './dataset-store';
import {DatasetError} from './errors';
import {readOnlyDatasetPolicy, validateStoredDatasetPolicy} from './policy/validation';
import {resolveDefinitionScope, resolveUserColumnScope, retainUserScope, validateUserContent} from './user-fields';

interface DatasetContent {
  format: ArtifactFormat;
  source: string | null;
  meta: Record<string, unknown>;
  access?: DatasetAccess;
}

export async function validatePublishedDataset(tx: Queryable, input: DatasetContent, userId: string | null, forkedFrom?: string): Promise<void> {
  // A fork copies the source's rows rather than assigning them as the forker.
  if (!forkedFrom) await validateUserContent(tx,input,userId,key=>loadDatasetRows({meta:{objectKey:key}}));
}

export function datasetCreationDefaults(input: DatasetContent, options: {forkedFrom?: string; datasetPolicy?: {policy: unknown; revision: number}}) {
  // An implicit stored dataset permits reads under the template; owners/editors may write.
  // Live datasets start without rules until an owner sets them.
  const useTemplate = !options.datasetPolicy && !options.forkedFrom && input.access===undefined && input.format==='dataset' && !liveConnectionOf(input.meta);
  return {
    access: input.access ?? (useTemplate ? 'readwrite' : 'read'),
    policy: options.datasetPolicy?.policy ?? (useTemplate ? readOnlyDatasetPolicy(input) : null),
    revision: options.datasetPolicy?.revision ?? 0,
  };
}

export async function prepareDatasetReplacement<T extends DatasetContent>(tx: Queryable, input: T, current: {meta: DatasetContent['meta']; dataset_policy?: unknown}, userId: string | null) {
  const prepared = retainUserScope(input,current);
  // Replacements keep the stored policy and its revision. Reject a catalog it no longer fits before checking row values.
  if (current.dataset_policy) {
    try { validateStoredDatasetPolicy(prepared,current.dataset_policy); }
    catch (error) { return reply({error:'policy_mismatch',detail:error instanceof Error?error.message:'The dataset policy does not fit this replacement.'},400); }
  }
  await validatePublishedDataset(tx,prepared,userId);
  return prepared;
}

export async function prepareDatasetRestore<T extends DatasetContent>(tx: Queryable, input: T, current: {meta: DatasetContent['meta']}, userId: string | null): Promise<T> {
  if (input.format==='dataset'&&!catalogOf(input)) throw new DatasetError('Historical dataset has no catalog or stored object key',400);
  const prepared = retainUserScope(input,current);
  await validatePublishedDataset(tx,prepared,userId);
  return prepared;
}

/** First attachment fills in a dataset's current document in its source, catalog and column metadata. */
export function bindDatasetUserScope(dataset: DatasetContent, documentId: string, mayBind: boolean) {
  const catalog = catalogOf(dataset);
  if (!catalog?.tables.some(t=>t.columns.some(c=>c.constraints?.memberOf?.includes('current')))) return null;
  if (!mayBind) throw new DatasetError('Only the dataset owner can bind memberOf current to a report',403);
  const columns = (cs: DatasetColumn[]) => resolveUserColumnScope(cs,documentId);
  const bound = {...catalog,tables:catalog.tables.map(t=>({...t,columns:columns(t.columns)}))};
  const source = resolveDefinitionScope(dataset.source,documentId)??null;
  const meta = {...dataset.meta,userScopeDocument:documentId,catalog:bound,columns:columns((dataset.meta.columns??[]) as DatasetColumn[])};
  return {source,meta};
}
