import {JOIN_RELATIONS} from '@/lib/social';
import { type ArtifactHeader, type ArtifactRow, getArtifactById, getArtifactFor, getLinkReadableArtifact, childrenTableFor } from '@/lib/artifacts';
import { writerFor, grantsOf, grantsPermitRead } from '@/lib/artifact-access';
import { ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import { type DocumentQuerySourceMode } from '../datasets';
import { type PersonCard } from '@artifactbin/contracts';
import { type ImportTables } from '@/lib/dataflow';
import { people, catalogOf, importedRows } from '@/lib/datasets';
import { getDb } from '../platform';

type RefData = {tables:ImportTables[string];catalog?:import('@/lib/datasets').DatasetCatalog};
type DatasetResolver = (id:string,mode?:DocumentQuerySourceMode)=>Promise<RefData|null>;

/** A resolved ref row → its data, under the viewer whose run this is. */
export async function tableForRef(r: ArtifactRow | null, viewer: AccessActor | null, document?:ArtifactRow, loadRows=true): Promise<RefData | null> {
  if (!r) return null;
  if (r.format === 'folder') {
    if (!loadRows) return {tables:{}};
    return { tables: { rows: await childrenTableFor(r, viewer) } };
  }
  if (r.format !== 'dataset') return null; // wrong kind → the query reports the missing table
  if(grantsOf(r)&&!(await grantsPermitRead(r,viewer??ANONYMOUS_ACTOR,document)))return null;
  const catalog=catalogOf(r);
  if(!catalog)return null; // missing storage is unavailable data, never an empty computed source
  if(!loadRows||catalog.kind==='postgres')return { tables: {}, catalog };
  try {
    return { tables: await importedRows(catalog), catalog };
  } catch { return null; } // the query reports the missing table
}

/** Host-only registered query imports retain the original document reach / viewer grants split.
 * Returns metadata only; the caller windows stored sources through executeCatalog. */
export async function registeredQueryImportForRow(row:ArtifactRow,id:string,viewer:AccessActor){
 const artifact=await importedArtifactFor(row,id);
 const data=await tableForRef(artifact,viewer,row,false);
 if(!artifact||artifact.format!=='dataset'||!data?.catalog)throw Error('query_source_unavailable');
 return {artifact,catalog:data.catalog};
}

/** The artifact a document's import names, by the document's own reach. */
const importedArtifactFor = async (row: ArtifactHeader, id: string): Promise<ArtifactRow | null> =>
  getArtifactById(id).then(async dataset=>dataset&&grantsOf(dataset)?dataset:(await getArtifactFor(writerFor(row),id))??(await getLinkReadableArtifact(id)));

/** A native reader may request its own person card, never arbitrary identities. */
export async function nameablePeople(_row:ArtifactRow,viewer:AccessActor|null,ids?:string[]):Promise<Record<string,PersonCard>> {
 const id=viewer?.userId;
 return id&&(!ids||ids.includes(id))?people(await getDb(),[id]):{};
}

/** A bearer/session actor's scope — the editor running a DRAFT's queries. Reach and viewer are the same person here. */
export const datasetResolverForActor = (actor: AccessActor): DatasetResolver => async (id,mode) =>
  tableForRef((await getArtifactFor(actor, id)) ?? (await getLinkReadableArtifact(id)), { ...actor },undefined,mode===undefined||mode==='import');

/** Resolve an admitted asset using the document owner's normal reference scope. */
export async function referencedArtifactForRow(row: ArtifactRow, id: string): Promise<ArtifactRow | null> {
  const refs = (row.meta as { refs?: Array<{ id: string }> }).refs ?? [];
  if (!refs.some((ref) => ref.id === id)) return null;
  return (await getArtifactFor(writerFor(row), id))
    ?? (await getLinkReadableArtifact(id));
}

export async function acceptedMembers(artifactId:string):Promise<import('@/lib/dataflow').Row[]>{
 return (await (await getDb()).query<import('@/lib/dataflow').Row>(`SELECT user_id,joined_at::text FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND status='accepted' ORDER BY joined_at,user_id`,[artifactId])).rows;
}
