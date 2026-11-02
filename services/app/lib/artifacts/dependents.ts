/**
 * WHAT DEPENDS ON AN ARTIFACT, in the owner's scope: the documents (and datasets holding its media)
 * that reference it, and the documents that declare writes to a dataset. The share menu and delete
 * ask this before changing what others rely on.
 */
import type {HtmlPageLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { storedMediaReferences } from '../datasets';
import { getDb } from '../platform';
import { artifactQuery } from './document';
import { getArtifactById } from './rows';
import { ownerScope, type ArtifactRow, type Scope } from '@/lib/artifact-access';

/** Current stored dataset cells participate in the same owner-scoped deletion graph.
 * No persisted index: existing datasets and every write path are immediately covered.
 * Errors reading promised objects fail closed, rather than permitting unsafe deletion.
 */
async function findDependentsScoped(scope: Scope, refId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const image=(await getArtifactById(refId))?.format==='image';
  const res = await artifactQuery<ArtifactRow>(db,
    `SELECT * FROM artifacts WHERE ${scope.where('$1')} AND ${image ? "format IN ('html','dataset')" : "format='html' AND meta::text LIKE $2"}`,
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
    if(row.id===refId)continue;
    if(row.format==='html'){
      const links=(row.meta.htmlLinks??[]) as readonly HtmlPageLink[];
      if(links.some(link=>link.kind==='dataset'&&targets.has(link.datasetId)))found.set(row.id,row);
      continue;
    }

  }
  return [...found.values()];
}

export function findDependentsFor(actor: AccessActor, refId: string): Promise<ArtifactRow[]> {
  return findDependentsScoped(ownerScope(actor), refId);
}
