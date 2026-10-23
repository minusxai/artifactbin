import type {AccessActor} from '@/lib/accounts';
import {canReadArtifact,getArtifactById,getVersionFor,writerFor,type ArtifactRow} from '@/lib/artifacts';
import type {HtmlDatasetLink} from '@artifactbin/contracts';
const unavailable=()=>new Error('dataset_not_found');
export async function authorizedDataset(actor:AccessActor,id:string){
 const row=await getArtifactById(id);
 if(!row||row.format!=='dataset'||!await canReadArtifact(row,actor))throw unavailable();
 return row;
}
export async function resolveDatasetBinding(actor:AccessActor,binding:HtmlDatasetLink):Promise<ArtifactRow>{
 const live=await authorizedDataset(actor,binding.datasetId);
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
 const current=await authorizedDataset(actor,binding.datasetId);
 return {...current,...version,version:Number(binding.revision)} as ArtifactRow;
}
/** Publication authorizes the original dataset, independently of page readership. */
export async function authorizeDatasetBinding(actor:AccessActor,binding:HtmlDatasetLink):Promise<void>{await resolveDatasetBinding(actor,binding);}
