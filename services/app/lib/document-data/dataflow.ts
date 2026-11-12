import { type ArtifactRow, getArtifactFor, getLinkReadableArtifact, childrenTableFor } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';
import { datasetReadAccess, datasetView, sqlRefusal } from '@/lib/dataset-permissions';
import { ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import type { Row, DatasetColumn } from '@artifactbin/contracts';
import { catalogOf, importedRows, importedTables, type CatalogRowView } from '@/lib/datasets';

type RefData = {tables:Record<string,{rows:Row[];columns:DatasetColumn[]}>;catalog?:import('@/lib/datasets').DatasetCatalog;view?:CatalogRowView|null};
type DatasetResolver = (id:string,mode?:'import'|'catalog'|'verify')=>Promise<RefData|null>;

/**
 * A resolved ref row → its data, under the viewer whose run this is. A document's queries are SQL over these rows
 * (imported tables and catalog sources alike), so a reader whose rules do not allow SQL on the dataset
 * (dataset-permissions `sqlRefusal`, the one SQL check) gets none: the query reports the missing table, as for a
 * dataset they cannot read. Pages read rows through GraphQL and compute through `_sql` instead.
 */
async function tableForRef(r: ArtifactRow | null, viewer: AccessActor | null, loadRows=true): Promise<RefData | null> {
  if (!r) return null;
  if (r.format === 'folder') {
    if (!loadRows) return {tables:{}};
    return { tables: { rows: await childrenTableFor(r, viewer) } };
  }
  if (r.format !== 'dataset') return null; // wrong kind → the query reports the missing table
  // The reader's dataset role, and its role view (lib/dataset-permissions).
  const decision=await datasetReadAccess(r,viewer??ANONYMOUS_ACTOR);
  if(!decision.allowed||sqlRefusal(decision))return null;
  const view=datasetView(decision);
  const catalog=catalogOf(r);
  if(!catalog)return null; // missing storage is unavailable data, never an empty computed source
  if(!loadRows)return { tables: {}, catalog, view };
  try {
    const tables=await importedRows(catalog);
    // Rows the select rule keeps, and only the columns it shows (the viewed catalog's).
    if(view)for(const table of importedTables(view.catalog(catalog))){const loaded=tables[table.name];if(loaded)tables[table.name]={rows:view.rows(table,loaded.rows),columns:table.columns};}
    return { tables, catalog, view };
  } catch { return null; } // the query reports the missing table
}

/** A bearer/session actor's scope — the editor running a DRAFT's queries. Reach and viewer are the same person here. */
export const datasetResolverForActor = (actor: AccessActor): DatasetResolver => async (id,mode) =>
  tableForRef((await getArtifactFor(actor, id)) ?? (await getLinkReadableArtifact(id)), { ...actor },mode===undefined||mode==='import');

/** Resolve an admitted asset using the document owner's normal reference scope. */
export async function referencedArtifactForRow(row: ArtifactRow, id: string): Promise<ArtifactRow | null> {
  const refs = (row.meta as { refs?: Array<{ id: string }> }).refs ?? [];
  if (!refs.some((ref) => ref.id === id)) return null;
  return (await getArtifactFor(writerFor(row), id))
    ?? (await getLinkReadableArtifact(id));
}
