/**
 * WHAT DEPENDS ON AN ARTIFACT, in the owner's scope: the documents (and datasets holding its media)
 * that reference it, and the documents that declare writes to a dataset. The share menu and delete
 * ask this before changing what others rely on.
 */
import type { TokenActor } from '@/lib/accounts';
import { mutationTargetRef } from '@/lib/dataflow';
import { storedMediaReferences } from '../datasets/media-references';
import { getDb } from '../platform/db';
import { artifactQuery } from './document';
import { compiledForRow } from './row-compile';
import { getArtifactById } from './rows';
import { ownerScope, type ArtifactRow, type Scope } from './table';

/**
 * The documents in the owner's scope that WRITE this dataset, with the
 * mutations they declare — what the share menu shows beside the toggle, so
 * turning writes off can say what will stop working. Same shape and scope as
 * `findDependents`, narrowed to declared writers.
 */
export async function findWritersFor(actor: TokenActor, datasetId: string): Promise<Array<{ id: string; title: string | null; mutations: string[] }>> {
  const dependents = await findDependentsFor(actor, datasetId);
  const out: Array<{ id: string; title: string | null; mutations: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    const flow = await compiledForRow(dep);
    const names = (flow?.mutations ?? []).filter((m) => mutationTargetRef(flow!, m) === datasetId).map((m) => m.name);
    if (names.length) out.push({ id: dep.id, title: dep.title, mutations: names });
  }
  return out;
}

/** Current stored dataset cells participate in the same owner-scoped deletion graph.
 * No persisted index: existing datasets and every write path are immediately covered.
 * Errors reading promised objects fail closed, rather than permitting unsafe deletion.
 */
async function findDependentsScoped(scope: Scope, refId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const image=(await getArtifactById(refId))?.format==='image';
  const res = await artifactQuery<ArtifactRow>(db,
    `SELECT * FROM artifacts WHERE ${scope.where('$1')} AND ${image ? "format IN ('markup','dataset')" : "format = 'markup' AND meta::text LIKE $2"}`,
    image ? [scope.val] : [scope.val,`%"${refId}"%`],
  );
  const rows=res.rows as unknown as ArtifactRow[];
  const targets=new Set([refId]);
  const found=new Map<string,ArtifactRow>();
  for(const row of rows){
    if(row.format!=='dataset'||row.id===refId)continue;
    if((await storedMediaReferences(row)).has(refId)){targets.add(row.id);found.set(row.id,row);}
  }
  for(const row of rows){
    if(row.format!=='markup'||row.id===refId)continue;
    const refs=(row.meta as {refs?:Array<{id:string}>}).refs??[];
    if(refs.some(ref=>targets.has(ref.id)))found.set(row.id,row);
  }
  return [...found.values()];
}

export function findDependentsFor(actor: TokenActor, refId: string): Promise<ArtifactRow[]> {
  return findDependentsScoped(ownerScope(actor), refId);
}
