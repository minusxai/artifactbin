import { type ArtifactRow, getArtifactFor, getLinkReadableArtifact, childrenTableFor } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';
import { datasetReadAccess, datasetView } from '@/lib/dataset-permissions';
import { ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import { type DocumentQuerySourceMode } from '../datasets';
import { type PersonCard } from '@artifactbin/contracts';
import { type ImportTables } from '@/lib/dataflow';
import { people, catalogOf, importedRows, importedTables, type CatalogRowView } from '@/lib/datasets';
import { getDb } from '../platform';

type RefData = {tables:ImportTables[string];catalog?:import('@/lib/datasets').DatasetCatalog;view?:CatalogRowView|null};
type DatasetResolver = (id:string,mode?:DocumentQuerySourceMode)=>Promise<RefData|null>;

/** A resolved ref row → its data, under the viewer whose run this is. */
async function tableForRef(r: ArtifactRow | null, viewer: AccessActor | null, loadRows=true): Promise<RefData | null> {
  if (!r) return null;
  if (r.format === 'folder') {
    if (!loadRows) return {tables:{}};
    return { tables: { rows: await childrenTableFor(r, viewer) } };
  }
  if (r.format !== 'dataset') return null; // wrong kind → the query reports the missing table
  // The reader's dataset role, and its role view (lib/dataset-permissions).
  const decision=await datasetReadAccess(r,viewer??ANONYMOUS_ACTOR);
  if(!decision.allowed)return null;
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

/** A native reader may request its own person card, never arbitrary identities. */
export async function nameablePeople(_row:ArtifactRow,viewer:AccessActor|null,ids?:string[]):Promise<Record<string,PersonCard>> {
 const id=viewer?.userId;
 return id&&(!ids||ids.includes(id))?people(await getDb(),[id]):{};
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
