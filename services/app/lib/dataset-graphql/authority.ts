import type { AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById, getVersionFor, type ArtifactRow } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';
import type {HtmlDatasetLink} from '@artifactbin/contracts';
import {catalogOf} from '@/lib/datasets';
import {datasetReadAccess,type DatasetReadDecision} from '@/lib/dataset-permissions';
export class DatasetBindingUnsupportedError extends Error {
 readonly code='dataset_stable_identity_unavailable';
 readonly hint='Native dataset bindings require stored CSV/JSON rows. Import rows into a stored dataset before linking this page.';
 constructor(){super('dataset_stable_identity_unavailable');}
}
/** Only catalogs with stored row objects can supply native stable row identity. */
export function datasetBindingCatalog(row:Pick<ArtifactRow,'meta'>){
 const catalog=catalogOf(row);
 if(!catalog||catalog.kind!=='stored'||catalog.tables.some(table=>!table.objectKey||table.sql!==undefined))throw new DatasetBindingUnsupportedError();
 return catalog;
}
const unavailable=()=>new Error('dataset_not_found');
/** Direct readership of the dataset (publication, forks): the dataset's own sharing and rules. */
async function authorizedDataset(actor:AccessActor,id:string){
 const row=await getArtifactById(id);
 if(!row||row.format!=='dataset'||!await canReadArtifact(row,actor))throw unavailable();
 return row;
}
/**
 * A read of a dataset's rows through GraphQL: the head and the reader's role view (lib/dataset-permissions).
 * Through a page linking it (the default), a reader without sharing of their own is signed_in or anonymous;
 * directly (`throughPage:false`, the dataset's own GraphQL endpoint), the dataset's sharing alone decides.
 */
export async function authorizedDatasetRead(actor:AccessActor,id:string,options:{throughPage:boolean}={throughPage:true}):Promise<{row:ArtifactRow;decision:DatasetReadDecision&{allowed:true}}>{
 const row=await getArtifactById(id);
 if(!row||row.format!=='dataset')throw unavailable();
 const decision=await datasetReadAccess(row,actor,{throughPage:options.throughPage});
 if(!decision.allowed)throw unavailable();
 return {row,decision};
}
export async function resolveDatasetBinding(actor:AccessActor,binding:HtmlDatasetLink,authorize:(actor:AccessActor,id:string)=>Promise<ArtifactRow>=authorizedDataset):Promise<ArtifactRow>{
 const live=await authorize(actor,binding.datasetId);
 if(binding.mode==='live')return live;
 if(!/^[1-9]\d*$/.test(binding.revision)||!Number.isSafeInteger(Number(binding.revision)))throw unavailable();
 if(binding.revision===String(live.version))return live;
 // This internal binding exposes only the immutable revision selected by the page link.
 // Current dataset readership authorizes that binding, not the editorial history API.
 // The canonical owner scope is only the retained archive loader's storage authority;
 // never use it to decide whether the caller may read, list history, or write.
 const version=await getVersionFor(writerFor(live),binding.datasetId,Number(binding.revision));
 if(!version||version.format!=='dataset')throw unavailable();
 // Revocation or deletion while the archive was loading must still refuse the read.
 const current=await authorize(actor,binding.datasetId);
 return {...current,...version,version:Number(binding.revision)} as ArtifactRow;
}
/** Publication authorizes the original dataset, independently of page readership. */
export async function authorizeDatasetBinding(actor:AccessActor,binding:HtmlDatasetLink):Promise<void>{datasetBindingCatalog(await resolveDatasetBinding(actor,binding));}
