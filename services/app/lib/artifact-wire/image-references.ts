/** Runtime reference resolution never inherits the containing document's ownership. */
import { ownsArtifact } from '@/lib/artifact-access';
import type { AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { imageReferenceId, imageRefData, type ImageRefData } from '@/lib/dataflow';

export async function resolveImageReference(value:string,actor:AccessActor,capture=false):Promise<ImageRefData|null> {
 const id=imageReferenceId(value);if(!id)return null;
 const row=await getArtifactById(id);
 if(!row||row.format!=='image'||!(ownsArtifact(row,actor)||await canReadArtifact(row, actor)))return null;
 return imageRefData(row,capture);
}
